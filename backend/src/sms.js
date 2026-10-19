// SMS dispatch via RingCentral
// ONLY [TEST] patients receive texts during development
// All real patients are blocked until PRODUCTION_SMS_ENABLED=true

const { SDK } = require("@ringcentral/sdk");

const PRODUCTION_SMS_ENABLED = process.env.PRODUCTION_SMS_ENABLED === "true";
const RC_FROM_NUMBER = process.env.RC_FROM_NUMBER;

// Lazy-init RingCentral client
let rcPlatform = null;
let rcSdk = null;

async function getRCPlatform(forceRefresh = false) {
  if (rcPlatform && !forceRefresh) return rcPlatform;

  const clientId = process.env.RC_CLIENT_ID;
  const clientSecret = process.env.RC_CLIENT_SECRET;
  const serverUrl = process.env.RC_SERVER_URL || "https://platform.ringcentral.com";
  const jwt = process.env.RC_JWT;

  if (!clientId || !clientSecret || !jwt) {
    console.log("[sms] RingCentral not configured (missing credentials)");
    return null;
  }

  // Reuse SDK instance but get fresh platform auth
  if (!rcSdk) {
    rcSdk = new SDK({
      server: serverUrl,
      clientId,
      clientSecret
    });
  }

  rcPlatform = rcSdk.platform();
  await rcPlatform.login({ jwt });
  console.log("[sms] RingCentral authenticated");
  return rcPlatform;
}

function isTestPatient(name) {
  return name.startsWith("[TEST]") || name.toLowerCase().startsWith("test ");
}

// ⚠️ This RingCentral account's POST /sms can answer a bare 500 while still
// ACCEPTING the message: it lands in the message store and is delivered about
// 30s later. The Command Center's gateway measured it on two separate apps, so
// it belongs to the account, not to an app (services/monday-gateway/smsSend.mjs
// in command-center-test, which this is ported from). Read as a failure, it gets
// the text sent again: by the intake recovery path, or by Monday redelivering a
// welcome-text webhook. So before a 5xx is reported as failed, look for the
// message in the store: same text, same recipient, created since the POST.
//
// Best-effort: it looks for six seconds, and a carrier can reject a message
// later than that. `failed` catches only the fast rejections.
const FAILED_STATUSES = new Set(["SendingFailed", "DeliveryFailed"]);
const last10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

async function confirmSmsAccepted({
  rcGet,
  to,
  text,
  sentAtMs = Date.now(),
  attempts = 3,
  delayMs = 2000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms))
}) {
  const NOT_FOUND = { accepted: false, failed: false, deliveryError: "", id: null };
  const want = last10(to);
  if (!want || !text) return NOT_FOUND;
  const dateFrom = new Date(sentAtMs - 60_000).toISOString();
  const path =
    `/restapi/v1.0/account/~/extension/~/message-store` +
    `?messageType=SMS&direction=Outbound&phoneNumber=${encodeURIComponent(to)}` +
    `&dateFrom=${encodeURIComponent(dateFrom)}&perPage=20`;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    try {
      const json = await rcGet(path);
      // Exact text and recipient: two different texts to one patient in the
      // same minute is ordinary, and mistaking one for the other would hide a
      // real failure.
      const hit = (json?.records ?? []).find(
        (r) =>
          String(r.subject ?? r.text ?? "").trim() === text.trim() &&
          (r.to ?? []).some((t) => last10(t.phoneNumber) === want)
      );
      if (hit) {
        const failed = FAILED_STATUSES.has(String(hit.messageStatus ?? ""));
        return {
          accepted: !failed,
          failed,
          deliveryError: failed ? String(hit.deliveryErrorCode ?? "") : "",
          id: hit.id ?? null
        };
      }
    } catch {
      // A failed read is not evidence the send failed. Look again.
    }
  }
  return NOT_FOUND;
}

// `from` defaults to this service's own number. The welcome texts pass Corey
// Deutsch's line explicitly (welcomeTexts.js); RingCentral refuses a number the
// authenticated extension doesn't own, so a mismatch fails loudly, not quietly.
async function sendSMS(phone, message, { patientName = "", from = RC_FROM_NUMBER } = {}) {
  const testPatient = isTestPatient(patientName);

  // Real patients: blocked unless PRODUCTION_SMS_ENABLED=true
  if (!testPatient && !PRODUCTION_SMS_ENABLED) {
    console.log(`[sms] BLOCKED (real patient "${patientName}"): production SMS not enabled`);
    return { sent: false, reason: "production_sms_disabled" };
  }

  // Validate phone
  if (!phone || phone.replace(/\D/g, "").length < 10) {
    console.log(`[sms] BLOCKED: invalid phone "${phone}"`);
    return { sent: false, reason: "invalid_phone" };
  }

  // Normalize phone to E.164
  let toNumber = phone.replace(/\D/g, "");
  if (toNumber.length === 10) toNumber = "1" + toNumber;
  toNumber = "+" + toNumber;

  // Try sending, with one retry on auth failure
  for (let attempt = 0; attempt < 2; attempt++) {
    let platform = null;
    const sentAtMs = Date.now();
    try {
      platform = await getRCPlatform(attempt > 0);
      if (!platform) {
        console.log(`[sms] SKIPPED (RC not configured) → ${toNumber}: "${message.substring(0, 80)}..."`);
        return { sent: false, reason: "ringcentral_not_configured" };
      }

      const resp = await platform.post("/restapi/v1.0/account/~/extension/~/sms", {
        from: { phoneNumber: from },
        to: [{ phoneNumber: toNumber }],
        text: message
      });

      const data = await resp.json();
      console.log(`[sms] SENT → ${toNumber} (${patientName}): "${message.substring(0, 60)}..." | ID: ${data.id}`);
      return { sent: true, messageId: data.id };
    } catch (err) {
      // The SDK throws on any non-2xx and hangs the response on the error.
      const status = err.response?.status;
      if (platform && status >= 500) {
        const found = await confirmSmsAccepted({
          rcGet: async (path) => (await platform.get(path)).json(),
          to: toNumber,
          text: message,
          sentAtMs
        });
        if (found.accepted) {
          console.log(`[sms] SENT → ${toNumber} (${patientName}): RingCentral answered ${status} but the message is in the store | ID: ${found.id}`);
          return { sent: true, messageId: found.id };
        }
        if (found.failed) {
          console.error(`[sms] FAILED → ${toNumber}: RingCentral gave up on it (${found.deliveryError || "no code"})`);
          return { sent: false, reason: "delivery_failed", deliveryError: found.deliveryError };
        }
      }

      // RingCentral spells stale-session errors inconsistently ("Token not
      // found", "Refresh token is missing") — match case-insensitively.
      const errText = (err.message || "").toLowerCase();
      const isAuthError = errText.includes("token") ||
                          errText.includes("unauthorized") ||
                          errText.includes("401");

      if (isAuthError && attempt === 0) {
        console.log(`[sms] Auth error, re-authenticating: ${err.message}`);
        rcPlatform = null; // Force fresh login on next attempt
        continue;
      }

      console.error(`[sms] FAILED → ${toNumber}: ${err.message}`);
      return { sent: false, reason: err.message };
    }
  }
}

module.exports = { sendSMS, isTestPatient, confirmSmsAccepted, PRODUCTION_SMS_ENABLED };
