// The one text a patient gets: the progress link sent when their case arrives
// on Medical Evaluation, and only for the referral sources on the text list.
// Runs the real webhook route in src/index.js (and the real src/redis.js) with
// Monday, RingCentral and the Redis client replaced -- see test/portal-app.js.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const P = require("./portal-app");

const { BOARDS, PATIENT_UID_COLUMNS, REFERRAL_SOURCE_COLUMN, PHONE_COLUMN, STAGE_COLUMNS, PORTAL_BASE_URL } = P.config;
const ME = BOARDS.MEDICAL_EVAL;
const UID_COL = PATIENT_UID_COLUMNS[ME];
const PHONE = "(212) 555-0142";

function addMedEvalPatient(id, { name = "Pat Example", referralSource = "Patient", phone = PHONE } = {}) {
  P.items.set(String(id), {
    id: String(id), name, board: { id: ME }, group: { id: "topics", title: "Evaluate" },
    column_values: [
      { id: PHONE_COLUMN, text: phone, value: null },
      { id: REFERRAL_SOURCE_COLUMN, text: referralSource, value: null },
      { id: UID_COL, text: "", value: null }
    ]
  });
}
const arrive = (id) => P.webhook({ type: "create_pulse", boardId: Number(ME), pulseId: Number(id) });
const medEvalStage = (id, index) => P.webhook({
  type: "update_column_value", boardId: Number(ME), pulseId: Number(id),
  columnId: STAGE_COLUMNS[ME], value: { label: { index } }
});
const uidOf = (id) => P.items.get(String(id)).column_values.find((c) => c.id === UID_COL).text;
const setPhone = (id, phone) => { P.items.get(String(id)).column_values.find((c) => c.id === PHONE_COLUMN).text = phone; };

before(P.start);
after(P.stop);
beforeEach(P.reset);

test("a new Medical Evaluation patient referred by Patient is texted once, at their phone, with their own tracking link", async () => {
  addMedEvalPatient(9000000001, { referralSource: "Patient" });
  const res = await arrive(9000000001);
  assert.equal(res.status, 200);
  assert.equal(res.body.stage, "0B");
  assert.equal(P.texts.length, 1);
  assert.equal(P.texts[0].phone, PHONE);
  const uid = uidOf(9000000001);
  assert.match(uid, /^[0-9a-f-]{36}$/);
  assert.ok(P.texts[0].message.includes(`${PORTAL_BASE_URL}?p=${uid}`));
  assert.match(P.texts[0].message, /^Hi, it's Medically Modern\. We've received your referral/);
});

test("a new District Endocrine referral is texted the District Endocrine wording, greeting the patient by first name, with their tracking link", async () => {
  addMedEvalPatient(9000000002, { name: "Dana Sample", referralSource: "District Endocrine" });
  await arrive(9000000002);
  assert.equal(P.texts.length, 1);
  const msg = P.texts[0].message;
  assert.match(msg, /^Hi Dana, it's Katie from Medically Modern\./);
  assert.ok(msg.includes("from District Endocrine"));
  assert.ok(msg.includes(`${PORTAL_BASE_URL}?p=${uidOf(9000000002)}`));
});

test("a new referral from Doctor, Tandem, CareCentrix or with Referral Source blank is not texted", async () => {
  let id = 9000000010;
  for (const source of ["Doctor", "Tandem", "CareCentrix", ""]) {
    id += 1;
    addMedEvalPatient(id, { referralSource: source });
    const res = await arrive(id);
    assert.equal(res.status, 200, source);
  }
  assert.equal(P.texts.length, 0);
});

test("Monday delivering the same arrival twice sends one text", async () => {
  addMedEvalPatient(9000000003);
  await arrive(9000000003);
  await arrive(9000000003);
  assert.equal(P.texts.length, 1);
});

test("a texted patient's later Medical Evaluation stage changes send no second text", async () => {
  addMedEvalPatient(9000000004);
  await arrive(9000000004);
  for (const index of [9, 10, 11, 14]) await medEvalStage(9000000004, index);
  assert.equal(P.texts.length, 1);
});

test("a Patient referral with no phone at arrival gets no text then, and is texted on its next Medical Evaluation stage change once a phone is on record", async () => {
  addMedEvalPatient(9000000005, { phone: "" });
  await arrive(9000000005);
  assert.equal(P.texts.length, 0);
  setPhone(9000000005, PHONE);
  await medEvalStage(9000000005, 9);
  assert.equal(P.texts.length, 1);
  assert.equal(P.texts[0].phone, PHONE);
  assert.ok(P.texts[0].message.includes(`?p=${uidOf(9000000005)}`));
});

test("a move to Stuck on Medical Evaluation never sends the arrival text", async () => {
  addMedEvalPatient(9000000006, { phone: "" });
  await arrive(9000000006);
  setPhone(9000000006, PHONE);
  await medEvalStage(9000000006, 15);
  assert.equal(P.texts.length, 0);
});

test("a patient the code lists as already texted by hand is not texted on arrival", async () => {
  const [handTexted] = Object.keys(P.config.MANUAL_INTAKE_SENDS);
  assert.ok(handTexted);
  addMedEvalPatient(handTexted, { referralSource: "Patient" });
  await arrive(handTexted);
  assert.equal(P.texts.length, 0);
});
