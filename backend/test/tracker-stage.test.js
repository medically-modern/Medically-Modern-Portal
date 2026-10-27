// What the patient's tracking page says once Final Profile Confirmation is sent:
// the Welcome Call board's stage-to-tracker settings in src/config.js, read
// through the real webhook and status routes in src/index.js (and the real
// src/redis.js) with Monday, RingCentral and the Redis client replaced -- see
// test/portal-app.js.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const P = require("./portal-app");

const { BOARDS, PATIENT_UID_COLUMNS, STAGE_COLUMNS, COMPLETED_GROUPS, STAGE_MAP, MESSAGES, PHONE_COLUMN } = P.config;
const WC = BOARDS.WELCOME_CALL;
const ADVANCER = STAGE_COLUMNS[WC];
const UID = "0a1b2c3d-0000-4000-8000-00000000c0de";

function addWelcomeCallPatient(id, { uid = UID, advancerIndex = null } = {}) {
  P.items.set(String(id), {
    id: String(id), name: "Pat Example", board: { id: WC }, group: { id: "topics", title: "Welcome Call" },
    column_values: [
      { id: PHONE_COLUMN, text: "(212) 555-0143", value: null },
      { id: PATIENT_UID_COLUMNS[WC], text: uid, value: null },
      { id: ADVANCER, text: "", value: advancerIndex === null ? null : JSON.stringify({ index: advancerIndex }) }
    ]
  });
}
const advance = (id, index) => P.webhook({
  type: "update_column_value", boardId: Number(WC), pulseId: Number(id), columnId: ADVANCER, value: { label: { index } }
});
const tracker = (uid = UID) => P.request("GET", `/api/status/uid/${uid}`);

before(P.start);
after(P.stop);
beforeEach(P.reset);

test("Final Confirm's send (Welcome Call Stage Advancer to Completed, index 4) makes the tracking page read You're All Set!, shown, with the all-set message", async () => {
  addWelcomeCallPatient(9100000001);
  const hook = await advance(9100000001, 4);
  assert.equal(hook.body.stage, "3C");
  const res = await tracker();
  assert.equal(res.status, 200);
  assert.equal(res.body.stage.label, "You're All Set!");
  assert.equal(res.body.stage.code, "3C");
  assert.equal(res.body.stage.visible, true);
  assert.equal(res.body.stage.message, "You're all set! Your equipment order is queued. Welcome to Medically Modern!");
});

test("a Welcome Call patient moved to the Completed group makes the tracking page read You're All Set!", async () => {
  addWelcomeCallPatient(9100000002);
  await P.webhook({ type: "move_item_to_group", boardId: Number(WC), pulseId: 9100000002, destGroupId: COMPLETED_GROUPS[WC] });
  const res = await tracker();
  assert.equal(res.body.stage.label, "You're All Set!");
  assert.equal(res.body.stage.code, "3C");
});

test("a patient in Final Profile Confirmation (Stage Advancer Review Profile, index 0) is not yet shown You're All Set!: the stage reads Final Profile Confirmation and is marked hidden", async () => {
  addWelcomeCallPatient(9100000003);
  await advance(9100000003, 0);
  const res = await tracker();
  assert.equal(res.body.stage.label, "Final Profile Confirmation");
  assert.equal(res.body.stage.code, "3B");
  assert.equal(res.body.stage.visible, false);
});

test("with nothing cached, the tracking page reads the Welcome Call Stage Advancer from the patient's record: Completed → You're All Set!", async () => {
  addWelcomeCallPatient(9100000004, { advancerIndex: 4 });
  const res = await tracker();
  assert.equal(res.status, 200);
  assert.equal(res.body.stage.label, "You're All Set!");
  assert.equal(res.body.stage.code, "3C");
  assert.equal(res.body.stage.message, MESSAGES.completed);
});

test("the Welcome Call Stage Advancer's labels map to the tracker: Welcome Call → Scheduling Your Welcome Call, Review Profile → Final Profile Confirmation (hidden), Completed → You're All Set!, Stuck → Under Review (hidden)", () => {
  const at = (index) => STAGE_MAP[`${WC}:${index}`];
  assert.deepEqual([at(7).label, at(7).visible], ["Scheduling Your Welcome Call", true]);
  assert.deepEqual([at(0).label, at(0).visible], ["Final Profile Confirmation", false]);
  assert.deepEqual([at(4).label, at(4).visible, at(4).code], ["You're All Set!", true, "3C"]);
  assert.deepEqual([at(2).label, at(2).visible], ["Under Review", false]);
});

test("no text is sent when a Welcome Call patient reaches You're All Set!", async () => {
  addWelcomeCallPatient(9100000005);
  await advance(9100000005, 4);
  assert.equal(P.texts.length, 0);
});
