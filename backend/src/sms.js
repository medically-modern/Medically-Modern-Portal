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

async function sendSMS(phone, message, { patientName = "" } = {}) {
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
    try {
      const platform = await getRCPlatform(attempt > 0);
      if (!platform) {
        console.log(`[sms] SKIPPED (RC not configured) → ${toNumber}: "${message.substring(0, 80)}..."`);
        return { sent: false, reason: "ringcentral_not_configured" };
      }

      const resp = await platform.post("/restapi/v1.0/account/~/extension/~/sms", {
        from: { phoneNumber: RC_FROM_NUMBER },
        to: [{ phoneNumber: toNumber }],
        text: message
      });

      const data = await resp.json();
      console.log(`[sms] SENT → ${toNumber} (${patientName}): "${message.substring(0, 60)}..." | ID: ${data.id}`);
      return { sent: true, messageId: data.id };
    } catch (err) {
      const isAuthError = err.message?.includes("Refresh token") ||
                          err.message?.includes("token") ||
                          err.message?.includes("Unauthorized") ||
                          err.message?.includes("401");

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

module.exports = { sendSMS, isTestPatient, PRODUCTION_SMS_ENABLED };
