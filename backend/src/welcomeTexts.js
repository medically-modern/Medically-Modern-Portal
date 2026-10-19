// ─── Welcome Call texts ───
// The texts the Welcome Call board sends a patient, moving here from Monday's
// RingCentral integration. Ten board automations send them today, each with its
// message typed into the automation: nine fire on Autotext Type (one per label,
// set by the board when a patient reaches the Welcome Call stage) and one on
// Welcome Call Text = Send, which the Command Center's button flips mid-call.
// Once they are switched off (docs/WEBHOOK-CONFIG.md has the cut-over), Monday
// sends this service a webhook when either column changes, and the column and
// label pick the message from the list below.
//
// Every message is copied word for word from the automation it replaces, with
// Monday's own {pulse.<column id>} placeholders left in. test/fixtures holds
// those automations as Monday exported them, and the test fails if a message
// here stops matching, so the wording can only change on purpose. To change a
// text, change it here and in the fixture together.
//
// Each one goes out from Corey Deutsch's line, +13475037148, as the automations
// did: replies land in the same RingCentral thread the team already works.
//
// ⚠️ Off until WELCOME_TEXTS says otherwise (see welcomeTextsMode). While the
// Monday automations are still on, a second sender here texts every patient
// twice. "test" texts only [TEST]/TEST patients, so the path can be tried on the
// live board before the automations are switched off.

const { BOARDS } = require("./config");

const AUTOTEXT_TYPE_COLUMN = "color_mm1xzh1x";
const WELCOME_CALL_TEXT_COLUMN = "color_mm1xtqvv";
const WELCOME_TEXT_FROM = "+13475037148";

// `replaces` is the Monday automation the entry stands in for. Autotext Type 1,
// General Diabetes, is set by nothing on the board since August 2026 (its
// setter, 7918358818, is off, and the automation is described "OFF/aug26"), but
// the text automation was still on, so a hand-set label still sends.
const WELCOME_TEXTS = [
  {
    column: AUTOTEXT_TYPE_COLUMN, index: 0, label: "Beta Bionics", replaces: 573200740,
    message: "YOUR INSULIN PUMP IS APPROVED AND READY FOR SHIPMENT\n\nProvider {pulse.text_mm1x46et} sent us your prescription for your Beta Bionics {pulse.color_mm1wjjtk} insulin pump, and our team at Medically Modern is ready to welcome you.\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call"
  },
  {
    column: AUTOTEXT_TYPE_COLUMN, index: 1, label: "General Diabetes", replaces: 573214800,
    message: "Great news, {pulse.name}!\n\nProvider {pulse.text_mm1x46et} sent us your prescription for your diabetes supplies, and our team at Medically Modern is ready to welcome you.\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call\n"
  },
  {
    column: AUTOTEXT_TYPE_COLUMN, index: 2, label: "Tandem", replaces: 573208150,
    message: "YOUR INSULIN PUMP IS APPROVED AND READY FOR SHIPMENT\n\nProvider {pulse.text_mm1x46et} sent us your prescription for your Tandem {pulse.color_mm1wjjtk} insulin pump, and our team at Medically Modern is ready to welcome you.\n\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call\n\nCheck out this quick infusion set video to see your options: \nhttps://youtu.be/LncrEnLoEJ4?si=_2DDOGSjKNdgspi0"
  },
  {
    column: AUTOTEXT_TYPE_COLUMN, index: 3, label: "Other - Pump", replaces: 603170115,
    message: "YOUR INSULIN PUMP IS APPROVED AND READY FOR SHIPMENT\n\nProvider {pulse.text_mm1x46et} sent us your prescription for your {pulse.color_mm1wjjtk} insulin pump, and our team at Medically Modern is ready to welcome you.\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call"
  },
  {
    column: AUTOTEXT_TYPE_COLUMN, index: 4, label: "Tandem Supplies Only", replaces: 573213734,
    message: "YOUR INSULIN PUMP SUPPLIES ARE APPROVED AND READY FOR SHIPMENT\n\nProvider {pulse.text_mm1x46et} sent us your prescription for your Tandem {pulse.color_mm1wjjtk} insulin pump supplies, and our team at Medically Modern is ready to welcome you.\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call\n\nCheck out this quick infusion set video to see your options: \nhttps://youtu.be/LncrEnLoEJ4?si=_2DDOGSjKNdgspi0 "
  },
  {
    column: AUTOTEXT_TYPE_COLUMN, index: 6, label: "Other - CGM", replaces: 603171287,
    message: "YOUR CGM IS APPROVED AND READY FOR SHIPMENT\n\nProvider {pulse.text_mm1x46et} sent us your prescription for your {pulse.color_mm1w7pmf}, and our team at Medically Modern is ready to welcome you.\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call"
  },
  {
    column: AUTOTEXT_TYPE_COLUMN, index: 7, label: "Other - Pump & CGM", replaces: 603172480,
    message: "YOUR INSULIN PUMP & CGM IS APPROVED AND READY FOR SHIPMENT\n\nProvider {pulse.text_mm1x46et} sent us your prescription for your {pulse.color_mm1wjjtk} insulin pump and {pulse.color_mm1w7pmf}, and our team at Medically Modern is ready to welcome you.\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call"
  },
  {
    column: AUTOTEXT_TYPE_COLUMN, index: 8, label: "Other - Supplies", replaces: 603173668,
    message: "YOUR INSULIN PUMP SUPPLIES ARE APPROVED AND READY FOR SHIPMENT\n\nProvider {pulse.text_mm1x46et} sent us your prescription for your {pulse.color_mm1wjjtk} insulin pump supplies, and our team at Medically Modern is ready to welcome you.\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call"
  },
  {
    column: AUTOTEXT_TYPE_COLUMN, index: 9, label: "Other - Supplies & CGM", replaces: 603174271,
    message: "YOUR INSULIN PUMP SUPPLIES & CGM ARE APPROVED AND READY FOR SHIPMENT\n\nProvider {pulse.text_mm1x46et} sent us your prescription for your {pulse.color_mm1wjjtk} insulin pump supplies and {pulse.color_mm1w7pmf}, and our team at Medically Modern is ready to welcome you.\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call"
  },
  // The Command Center's "Send Welcome Call Text" button. It writes the address
  // and phone first and flips this column last, after reading them back, so the
  // item read below already carries what the rep just confirmed. Its
  // automation was a newer Monday workflow, so its message was rich text rather
  // than a string; this is that text with each line break as "\n".
  {
    column: WELCOME_CALL_TEXT_COLUMN, index: 0, label: "Send", replaces: 7918318033,
    message: "Medically Modern --> SAVE OUR NUMBER\n\nTO CONFIRM: \nDelivery Address -  {pulse.location_mm1xhw17}\n\nOrder \nCGM - {pulse.color_mm1w7pmf}\nPump - {pulse.color_mm1wjjtk}\nInfusion Sets - {pulse.color_mm1x9paw}  {pulse.color_mm1xekaz}\n\nHOW IT WORKS: \n20-days before your next order we send you a text to confirm your address & order. We need an affirmative \"yes\" from you\n "
  }
];

const PRIMARY_PHONE_COLUMN = "phone_mm1x44yk";

// off (the default), test, or on. Anything unrecognised is off: a typo in the
// variable must not start texting patients.
function welcomeTextsMode(env = process.env) {
  const value = String(env.WELCOME_TEXTS || "").trim().toLowerCase();
  return value === "on" || value === "test" ? value : "off";
}

function isWelcomeTextColumn(boardId, columnId) {
  return String(boardId) === BOARDS.WELCOME_CALL &&
    (columnId === AUTOTEXT_TYPE_COLUMN || columnId === WELCOME_CALL_TEXT_COLUMN);
}

// The label the column changed to, or null when it was cleared. Monday sends the
// value as a string or an object depending on the event, as the stage advancer
// handler in index.js also has to allow for.
function labelIndexOf(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch (e) { return null; }
  }
  const index = parsed?.label?.index ?? parsed?.index;
  return Number.isInteger(index) ? index : null;
}

function welcomeTextFor(columnId, labelIndex) {
  return WELCOME_TEXTS.find((t) => t.column === columnId && t.index === labelIndex) || null;
}

// What Monday puts in a {pulse.<id>} placeholder: the item name for "name", the
// address for a location column (the workflow read `address`, which can differ
// from the column's text), and the column's text otherwise. A blank column is "".
function placeholderValue(item, columnId) {
  if (columnId === "name") return item?.name || "";
  const column = item?.column_values?.find((c) => c.id === columnId);
  if (!column) return "";
  if (column.type === "location" && column.value) {
    try {
      const address = JSON.parse(column.value)?.address;
      if (address) return address;
    } catch (e) { /* fall back to the text */ }
  }
  return column.text || "";
}

// Trimmed at the end: a few of the messages above end in a stray space or line
// break, which a phone shows as nothing but which would make the text RingCentral
// stores differ from the one sendSMS looks for after a 5xx.
function renderWelcomeText(template, item) {
  return template.message
    .replace(/\{pulse\.([a-z0-9_]+)\}/g, (_, columnId) => placeholderValue(item, columnId))
    .trimEnd();
}

// One send per change on the board. Monday retries a delivery once a minute for
// 30 minutes, and every retry carries the triggerUuid of the change it is for.
function claimKeyOf(event) {
  if (event.triggerUuid) return String(event.triggerUuid);
  if (event.changedAt) return `${event.pulseId}:${event.columnId}:${event.changedAt}`;
  return null;
}

// Failures a retry cannot fix. Anything else (RingCentral down, a timeout) is
// handed back to Monday as a 500 so it redelivers.
const FINAL_SEND_FAILURES = new Set([
  "production_sms_disabled",
  "invalid_phone",
  "ringcentral_not_configured",
  "delivery_failed"
]);

// Returns { httpStatus, status, reason } for the webhook to answer with.
// Everything it needs is passed in, so the test runs it without Monday,
// RingCentral or Redis.
async function handleWelcomeTextEvent(event, { mode, getItem, sendSMS, isTestPatient, claim, confirm, release, log = console.log }) {
  const itemId = event.pulseId || event.itemId;
  const labelIndex = labelIndexOf(event.value);
  const done = (status, reason, httpStatus = 200) => {
    log(`[welcome-text] item ${itemId} ${event.columnId}=${labelIndex}: ${status}${reason ? ` (${reason})` : ""}`);
    return { httpStatus, status, reason };
  };

  if (labelIndex === null) return done("ignored", "cleared");
  const template = welcomeTextFor(event.columnId, labelIndex);
  // A label added on the board after this list was written. The automations
  // sent nothing for a label they didn't name either, but say so loudly.
  if (!template) return done("ignored", "no_template_for_label");
  if (mode === "off") return done("ignored", "welcome_texts_off");

  let item;
  try {
    item = await getItem(itemId);
  } catch (err) {
    return done("error", `monday read failed: ${err.message}`, 500);
  }
  if (!item) return done("ignored", "item_not_found");

  const patientName = item.name || "";
  if (mode === "test" && !isTestPatient(patientName)) return done("ignored", "test_mode_real_patient");

  const phone = placeholderValue(item, PRIMARY_PHONE_COLUMN);
  if (!phone) return done("suppressed", "no_primary_phone");

  const message = renderWelcomeText(template, item);
  const key = claimKeyOf(event);
  if (key) {
    let claimed;
    try {
      claimed = await claim(key);
    } catch (err) {
      // Redis unreachable: send. A duplicate is the lesser harm.
      log(`[welcome-text] claim failed for item ${itemId}: ${err.message}; sending anyway`);
      claimed = true;
    }
    if (!claimed) return done("skipped", "already_sent_for_this_change");
  } else {
    log(`[welcome-text] item ${itemId}: event has no triggerUuid or changedAt; sending without a duplicate check`);
  }

  let result;
  try {
    result = await sendSMS(phone, message, { patientName, from: WELCOME_TEXT_FROM });
  } catch (err) {
    result = { sent: false, reason: err.message };
  }

  if (result.sent) {
    if (key) {
      try {
        await confirm(key, { itemId: String(itemId), text: template.label, sentAt: new Date().toISOString(), messageId: result.messageId || null });
      } catch (err) {
        log(`[welcome-text] item ${itemId}: sent, but recording it failed: ${err.message}`);
      }
    }
    return done("sent", template.label);
  }

  if (FINAL_SEND_FAILURES.has(result.reason)) return done("not_sent", result.reason);

  // Let Monday's next redelivery through. If the release itself fails, the
  // pending claim lapses on its own well inside Monday's 30 minutes of retries.
  if (key) {
    try { await release(key); } catch (err) { log(`[welcome-text] release failed for item ${itemId}: ${err.message}`); }
  }
  return done("error", `send failed: ${result.reason}`, 500);
}

// ─── The two webhooks ───
// While the texts are in test or on, the service makes sure Monday sends it both
// columns, creating whichever webhook is missing when it starts. It does this
// itself because the webhook URL carries MONDAY_WEBHOOK_SECRET, which only this
// service holds; created here, the secret never leaves Railway and Monday.
//
// Monday lists a board's webhooks with their event and column but never their
// URL, so "already there" means any column-change webhook on that column.
// Nothing else watched either column when this was written (2026-10-19). If
// another service adds one, this skips ours and the texts stop arriving, which
// test mode shows.
const WEBHOOK_URL_BASE = "https://patient-portal-backend-production.up.railway.app/webhooks/monday/";

// Monday writes the config back as a Ruby hash: {"columnId" => "color_mm1xzh1x"}.
function webhookColumnOf(config) {
  const m = String(config || "").match(/"columnId"\s*(?:=>|:)\s*"([a-z0-9_]+)"/);
  return m ? m[1] : null;
}

async function ensureWelcomeTextWebhooks({ mondayQuery, secret, log = console.log }) {
  if (!secret) {
    log("[welcome-text] webhooks not checked: MONDAY_WEBHOOK_SECRET is not set");
    return [];
  }
  // Nothing below may log the secret, including inside a Monday error message.
  const scrub = (text) => String(text).split(secret).join("<secret>");
  const results = [];
  try {
    const data = await mondayQuery(
      `query ($board_id: ID!) { webhooks(board_id: $board_id) { id event config } }`,
      { board_id: BOARDS.WELCOME_CALL },
      { forwardToFriday: false }
    );
    const existing = data?.webhooks || [];
    for (const columnId of [AUTOTEXT_TYPE_COLUMN, WELCOME_CALL_TEXT_COLUMN]) {
      const found = existing.find((w) => w.event === "change_specific_column_value" && webhookColumnOf(w.config) === columnId);
      if (found) {
        results.push({ columnId, id: String(found.id), created: false });
        log(`[welcome-text] webhook for ${columnId}: already there (${found.id})`);
        continue;
      }
      const made = await mondayQuery(
        `mutation ($board_id: ID!, $url: String!, $config: JSON) { create_webhook(board_id: $board_id, url: $url, event: change_specific_column_value, config: $config) { id } }`,
        { board_id: BOARDS.WELCOME_CALL, url: WEBHOOK_URL_BASE + secret, config: JSON.stringify({ columnId }) },
        { forwardToFriday: false }
      );
      const id = String(made?.create_webhook?.id || "");
      results.push({ columnId, id, created: true });
      log(`[welcome-text] webhook for ${columnId}: created (${id})`);
    }
  } catch (err) {
    log(`[welcome-text] webhook check failed: ${scrub(err.message)}`);
  }
  return results;
}

module.exports = {
  AUTOTEXT_TYPE_COLUMN, WELCOME_CALL_TEXT_COLUMN, WELCOME_TEXT_FROM, PRIMARY_PHONE_COLUMN, WELCOME_TEXTS,
  welcomeTextsMode, isWelcomeTextColumn, labelIndexOf, welcomeTextFor, placeholderValue, renderWelcomeText,
  claimKeyOf, handleWelcomeTextEvent, webhookColumnOf, ensureWelcomeTextWebhooks
};
