// The Welcome Call texts say exactly what Monday's RingCentral automations said,
// and the webhook path sends each one once. The fixture is those automations as
// Monday exported them on 2026-10-19; nothing here talks to Monday, RingCentral
// or Redis.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fixture = require("./fixtures/monday-welcome-sms-automations.json");
const W = require("../src/welcomeTexts");
const { confirmSmsAccepted } = require("../src/sms");
const src = (f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");

// The workflow's message is rich text: paragraphs of text, line breaks, and
// fields that point at a variable, each variable naming "item.<column>.<part>".
// Written as a {pulse.<column>} placeholder, the same form the recipes use.
function lexicalToTemplate(lexical, fields) {
  return lexical.root.children.map((paragraph) => paragraph.children.map((node) => {
    if (node.type === "text") return node.text;
    if (node.type === "linebreak") return "\n";
    if (node.type === "field") return `{pulse.${fields[String(node.variableKey)].split(".")[1]}}`;
    throw new Error(`unhandled node ${node.type}`);
  }).join("")).join("\n");
}

test("every RingCentral recipe's message is here word for word, on the same trigger, phone column and sender", () => {
  assert.equal(fixture.recipes.length, 9);
  for (const recipe of fixture.recipes) {
    const t = W.welcomeTextFor(recipe.columnId, recipe.index);
    assert.ok(t, `no text for ${recipe.columnId}=${recipe.index} (automation ${recipe.id})`);
    assert.equal(t.message, recipe.message, `automation ${recipe.id}`);
    assert.equal(t.replaces, recipe.id);
    assert.equal(recipe.from, W.WELCOME_TEXT_FROM);
    assert.equal(recipe.phoneColumn, W.PRIMARY_PHONE_COLUMN);
  }
});

test("the Welcome Call Text workflow's rich-text message is here word for word", () => {
  const wf = fixture.workflow;
  const t = W.welcomeTextFor(wf.columnId, wf.index);
  assert.ok(t);
  assert.equal(t.message, lexicalToTemplate(wf.lexical, wf.fields));
  assert.equal(t.replaces, Number(wf.id));
  assert.equal(wf.from, W.WELCOME_TEXT_FROM);
  assert.equal(wf.phoneColumn, W.PRIMARY_PHONE_COLUMN);
});

test("nothing here that Monday didn't send, and every label on both columns has its text", () => {
  assert.equal(W.WELCOME_TEXTS.length, fixture.recipes.length + 1);
  for (const [columnId, labels] of Object.entries(fixture.labels).filter(([k]) => k !== "note")) {
    for (const [index, label] of Object.entries(labels)) {
      const t = W.welcomeTextFor(columnId, Number(index));
      assert.ok(t, `${columnId} label ${index} "${label}" has no text`);
      assert.equal(t.label, label);
    }
  }
  const placeholders = new Set(W.WELCOME_TEXTS.flatMap((t) => [...t.message.matchAll(/\{pulse\.([a-z0-9_]+)\}/g)].map((m) => m[1])));
  assert.deepEqual([...placeholders].sort(), ["color_mm1w7pmf", "color_mm1wjjtk", "color_mm1x9paw", "color_mm1xekaz", "location_mm1xhw17", "name", "text_mm1x46et"]);
});

const item = (name, cols) => ({
  id: "1", name,
  column_values: Object.entries(cols).map(([id, c]) => ({ id, type: c.type || "text", text: c.text ?? "", value: c.value ?? null }))
});
const patient = (name = "Jane Roe") => item(name, {
  phone_mm1x44yk: { type: "phone", text: "+1 555 010 0123" },
  text_mm1x46et: { text: "Dr. Smith" },
  color_mm1wjjtk: { type: "status", text: "Mobi" },
  color_mm1w7pmf: { type: "status", text: "Dexcom G7" },
  color_mm1x9paw: { type: "status", text: "AutoSoft XC 6 mm 23\"" },
  color_mm1xekaz: { type: "status", text: "" },
  location_mm1xhw17: { type: "location", text: "1 Main St, Town, NJ", value: JSON.stringify({ lat: 1, lng: 2, address: "1 Main St, Town, NJ 07000" }) }
});

test("placeholders take the column text, the location's address and the item name; blanks are empty; the end is trimmed", () => {
  const p = patient();
  assert.equal(
    W.renderWelcomeText(W.welcomeTextFor(W.AUTOTEXT_TYPE_COLUMN, 3), p),
    "YOUR INSULIN PUMP IS APPROVED AND READY FOR SHIPMENT\n\nProvider Dr. Smith sent us your prescription for your Mobi insulin pump, and our team at Medically Modern is ready to welcome you.\n\nGet onboarded by scheduling your welcome call here:\nhttps://calendly.com/records-medicallymodern/welcome-call"
  );
  assert.match(W.renderWelcomeText(W.welcomeTextFor(W.AUTOTEXT_TYPE_COLUMN, 1), p), /^Great news, Jane Roe!\n/);
  const wct = W.renderWelcomeText(W.welcomeTextFor(W.WELCOME_CALL_TEXT_COLUMN, 0), p);
  assert.match(wct, /Delivery Address - {2}1 Main St, Town, NJ 07000\n/);
  assert.match(wct, /\nCGM - Dexcom G7\nPump - Mobi\nInfusion Sets - AutoSoft XC 6 mm 23" {2}\n/);
  assert.ok(wct.endsWith("We need an affirmative \"yes\" from you"));
  assert.ok(W.renderWelcomeText(W.welcomeTextFor(W.AUTOTEXT_TYPE_COLUMN, 4), p).endsWith("si=_2DDOGSjKNdgspi0"));
});

test("off unless WELCOME_TEXTS is exactly test or on", () => {
  assert.equal(W.welcomeTextsMode({}), "off");
  assert.equal(W.welcomeTextsMode({ WELCOME_TEXTS: "true" }), "off");
  assert.equal(W.welcomeTextsMode({ WELCOME_TEXTS: " Test " }), "test");
  assert.equal(W.welcomeTextsMode({ WELCOME_TEXTS: "ON" }), "on");
});

test("only the two columns, only on the Welcome Call board", () => {
  assert.ok(W.isWelcomeTextColumn(18410804557, "color_mm1xzh1x"));
  assert.ok(W.isWelcomeTextColumn("18410804557", "color_mm1xtqvv"));
  assert.ok(!W.isWelcomeTextColumn("18410804557", "color_mm1ws96t"));
  assert.ok(!W.isWelcomeTextColumn("18406060017", "color_mm1xzh1x"));
});

// A fake world: Monday's item, RingCentral's answers and Redis's claims.
function world({ name = "Jane Roe", sendResults = [{ sent: true, messageId: "m1" }], getItemThrows = false, claimThrows = false, itemOverride } = {}) {
  const sent = [], claims = new Map(), released = [], confirmed = [];
  const deps = {
    mode: "on",
    getItem: async () => { if (getItemThrows) throw new Error("monday down"); return itemOverride === undefined ? patient(name) : itemOverride; },
    sendSMS: async (phone, message, opts) => { sent.push({ phone, message, ...opts }); return sendResults.shift() || { sent: true }; },
    isTestPatient: (n) => n.startsWith("[TEST]") || n.toLowerCase().startsWith("test "),
    claim: async (key) => { if (claimThrows) throw new Error("redis down"); if (claims.has(key)) return false; claims.set(key, "pending"); return true; },
    confirm: async (key, record) => { claims.set(key, record); confirmed.push(record); },
    release: async (key) => { claims.delete(key); released.push(key); },
    log: () => {}
  };
  return { deps, sent, claims, released, confirmed };
}
const change = (columnId, index, extra = {}) => ({
  type: "update_column_value", boardId: 18410804557, pulseId: 42, columnId,
  value: index === null ? null : { label: { index, text: "x" }, post_id: null },
  triggerUuid: "t-1", changedAt: 1760000000.1, ...extra
});

test("a change sends its text once, from Corey's line, to Primary Phone", async () => {
  const w = world();
  const out = await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 6), w.deps);
  assert.deepEqual(out, { httpStatus: 200, status: "sent", reason: "Other - CGM" });
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].phone, "+1 555 010 0123");
  assert.equal(w.sent[0].from, "+13475037148");
  assert.equal(w.sent[0].patientName, "Jane Roe");
  assert.match(w.sent[0].message, /^YOUR CGM IS APPROVED AND READY FOR SHIPMENT\n\nProvider Dr. Smith sent us your prescription for your Dexcom G7, /);
  assert.deepEqual(Object.keys(w.confirmed[0]).sort(), ["itemId", "messageId", "sentAt", "text"], "the record holds no patient data");

  // Monday redelivering the same change: no second text
  const again = await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 6), w.deps);
  assert.equal(again.status, "skipped");
  assert.equal(w.sent.length, 1);

  // a rep resets Welcome Call Text and presses Send again: a new change, a new text
  await W.handleWelcomeTextEvent(change(W.WELCOME_CALL_TEXT_COLUMN, 0, { triggerUuid: "t-2" }), w.deps);
  await W.handleWelcomeTextEvent(change(W.WELCOME_CALL_TEXT_COLUMN, 0, { triggerUuid: "t-3" }), w.deps);
  assert.equal(w.sent.length, 3);
});

test("a cleared column, an unknown label, and the off switch send nothing and read nothing", async () => {
  for (const [event, mode, reason] of [
    [change(W.WELCOME_CALL_TEXT_COLUMN, null), "on", "cleared"],
    [change(W.AUTOTEXT_TYPE_COLUMN, 5), "on", "no_template_for_label"],
    [change(W.AUTOTEXT_TYPE_COLUMN, 0), "off", "welcome_texts_off"]
  ]) {
    const w = world({ getItemThrows: true });
    const out = await W.handleWelcomeTextEvent(event, { ...w.deps, mode });
    assert.deepEqual(out, { httpStatus: 200, status: "ignored", reason });
    assert.equal(w.sent.length, 0);
  }
});

test("test mode texts [TEST] and TEST patients only", async () => {
  const real = world({ name: "Jane Roe" });
  assert.equal((await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 0), { ...real.deps, mode: "test" })).reason, "test_mode_real_patient");
  assert.equal(real.sent.length, 0);
  assert.equal(real.claims.size, 0, "nothing claimed for a patient it skipped");
  for (const name of ["[TEST] Portal Alpha", "TEST Welcome One"]) {
    const t = world({ name });
    assert.equal((await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 0), { ...t.deps, mode: "test" })).status, "sent");
  }
});

test("a send that failed for a passing reason is handed back to Monday, and its retry goes through", async () => {
  const w = world({ sendResults: [{ sent: false, reason: "Request timed out" }, { sent: true, messageId: "m2" }] });
  const first = await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 2), w.deps);
  assert.equal(first.httpStatus, 500);
  assert.deepEqual(w.released, ["t-1"]);
  const retry = await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 2), w.deps);
  assert.equal(retry.status, "sent");
  assert.equal(w.sent.length, 2);
});

test("a failure no retry can fix answers 200 and keeps the claim", async () => {
  for (const reason of ["invalid_phone", "production_sms_disabled", "ringcentral_not_configured", "delivery_failed"]) {
    const w = world({ sendResults: [{ sent: false, reason }] });
    const out = await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 2), w.deps);
    assert.deepEqual(out, { httpStatus: 200, status: "not_sent", reason });
    assert.equal(w.released.length, 0);
  }
});

test("Monday unreadable: 500 before anything is claimed; no phone: nothing sent; Redis down: sent anyway", async () => {
  const down = world({ getItemThrows: true });
  assert.equal((await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 0), down.deps)).httpStatus, 500);
  assert.equal(down.claims.size, 0);

  const noPhone = patient();
  noPhone.column_values.find((c) => c.id === "phone_mm1x44yk").text = "";
  const w = world({ itemOverride: noPhone });
  assert.equal((await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 0), w.deps)).reason, "no_primary_phone");
  assert.equal(w.sent.length, 0);

  const redisDown = world({ claimThrows: true });
  assert.equal((await W.handleWelcomeTextEvent(change(W.AUTOTEXT_TYPE_COLUMN, 0), redisDown.deps)).status, "sent");
});

test("the duplicate check keys on Monday's triggerUuid, then on the change itself", () => {
  assert.equal(W.claimKeyOf({ triggerUuid: "abc", pulseId: 1, columnId: "c", changedAt: 2 }), "abc");
  assert.equal(W.claimKeyOf({ pulseId: 1, columnId: "c", changedAt: 2 }), "1:c:2");
  assert.equal(W.claimKeyOf({ pulseId: 1, columnId: "c" }), null);
  assert.equal(W.labelIndexOf('{"label":{"index":4}}'), 4);
  assert.equal(W.labelIndexOf({ index: 0 }), 0);
  assert.equal(W.labelIndexOf(null), null);
});

test("the webhook routes the two columns to the handler before the stage advancer filter drops them", () => {
  const index = src("index.js");
  const welcome = index.indexOf('} else if (type === "update_column_value" && isWelcomeTextColumn(boardId, event.columnId)) {');
  const stage = index.indexOf('} else if (type === "update_column_value") {');
  assert.ok(welcome > 0 && welcome < stage);
  assert.match(index, /claim: claimWelcomeText, confirm: confirmWelcomeText, release: releaseWelcomeText/);
  assert.match(index, /mode: welcomeTextsMode\(process\.env\)/);
  assert.match(index, /welcomeTexts: welcomeTextsMode\(process\.env\)/, "/health says which mode is live");
});

// sendSMS's look in RingCentral's store after a 5xx (sms.js).
const store = (records) => async () => ({ records });
const noWait = { sleep: async () => {} };

test("a 5xx'd text found in the store counts as sent; one RingCentral already gave up on counts as failed", async () => {
  const to = "+15550100123";
  const text = "Hello\nthere";
  assert.deepEqual(
    await confirmSmsAccepted({ rcGet: store([{ id: 7, subject: "Hello\nthere", messageStatus: "Queued", to: [{ phoneNumber: to }] }]), to, text, ...noWait }),
    { accepted: true, failed: false, deliveryError: "", id: 7 }
  );
  assert.deepEqual(
    await confirmSmsAccepted({ rcGet: store([{ id: 8, subject: text, messageStatus: "SendingFailed", deliveryErrorCode: "SMS-CAR-411", to: [{ phoneNumber: to }] }]), to, text, ...noWait }),
    { accepted: false, failed: true, deliveryError: "SMS-CAR-411", id: 8 }
  );
});

test("a different text or recipient is not proof, and a failing read is looked at again", async () => {
  const to = "+15550100123";
  let reads = 0;
  const out = await confirmSmsAccepted({
    rcGet: async () => {
      reads++;
      if (reads === 1) throw new Error("429");
      return { records: [
        { id: 1, subject: "Another text", to: [{ phoneNumber: to }] },
        { id: 2, subject: "Hello", to: [{ phoneNumber: "+15550100999" }] }
      ] };
    },
    to, text: "Hello", ...noWait
  });
  assert.equal(reads, 3);
  assert.equal(out.accepted, false);
  assert.equal(out.failed, false);
});

test("sendSMS checks the store only after a 5xx, and sends from the number it is given", () => {
  const sms = src("sms.js");
  assert.match(sms, /if \(platform && status >= 500\) \{\s*const found = await confirmSmsAccepted\(/);
  assert.match(sms, /from: \{ phoneNumber: from \}/);
  assert.match(sms, /from = RC_FROM_NUMBER/);
});
