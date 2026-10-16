// The Friday forward is wired, not just written, and it can only ever POST to Friday AFTER Monday said yes (Josh,
// 2026-10-16: "be EXTRA CAUTIOUS that we are ONLY adding a post everything goes well on monday send to friday friday
// can never negatively affect production"). Monday and Friday are stubs; nothing leaves the box.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const src = (f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");

test("monday.js hooks mondayQuery once, after Monday answered 2xx with data and no errors, in its own try", () => {
  const m = src("monday.js");
  const q = m.slice(m.indexOf("async function mondayQuery("), m.indexOf("// Get a single item by ID"));
  const guard = q.indexOf("if (res.ok && data && data.data) {");
  const hook = q.indexOf("try { fridayForward.onMutation({ query, variables, data: data.data }); } catch");
  assert.ok(guard > q.indexOf("if (data.errors)") && hook > guard && hook < q.indexOf("return data.data;"));
  assert.equal((m.match(/fridayForward\.on/g) || []).length, 1, "one hook");
  assert.match(m, /service: "patient-intake-texts-backend"/);
});

test("/health reports the forward", () => {
  assert.match(src("index.js"), /friday: fridayForward\.status\(\)/);
});

test("a Monday write goes to Monday exactly as before; only a clean yes is queued for Friday; Friday failing changes nothing", async () => {
  process.env.FRIDAY_FORWARD = "1";
  process.env.FRIDAY_URL = "https://friday.test";
  process.env.FRIDAY_API_KEY = "fk_live_test";
  process.env.FRIDAY_BOARD_IDS = "18406060017";
  const monday = [], friday = [];
  let answer = { status: 200, body: { data: { change_column_value: { id: "42" } } } };
  let fridayDown = false;
  global.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.monday.com")) {
      monday.push(JSON.parse(init.body));
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
    }
    if (String(url).startsWith("https://friday.test")) {
      friday.push({ url: String(url), body: JSON.parse(init.body) });
      if (fridayDown) throw new Error("Friday is down");
      return new Response(JSON.stringify({ applied: 1, skipped: 0, ignored: 0, problems: 0, operations: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const m = require("../src/monday.js");
  m.fridayForward.stop();   // no timer in a test: tick() by hand

  // the Patient UID on a new Medical Evaluation item: Monday's answer comes back unchanged, then Friday is queued
  const r = await m.updateColumn("18406060017", "123", "text_mm3ac5a0", "0f8fad5b-d9cb-469f-a165-70867728950e");
  assert.deepEqual(r, { id: "42" }, "the caller gets Monday's answer, unchanged");
  assert.equal(monday.length, 1, "one Monday call");
  assert.equal(friday.length, 0, "nothing sent to Friday during the Monday call");
  assert.equal(m.fridayForward.queue.length, 1);
  await m.fridayForward.tick();
  assert.equal(friday.length, 1);
  assert.equal(friday[0].url, "https://friday.test/v1/monday/write");
  assert.equal(friday[0].body.query, monday[0].query, "the same write, as sent");

  // another board (Subscription): Monday as before, nothing queued
  await m.updateColumn("18407459988", "124", "text_mm3af3zt", "x");
  assert.equal(m.fridayForward.queue.length, 0);

  // Monday says no: the error reaches the caller as before, nothing queued
  answer = { status: 200, body: { errors: [{ message: "bad column" }] } };
  await assert.rejects(m.updateColumn("18406060017", "125", "text_mm3ac5a0", "x"));
  assert.equal(m.fridayForward.queue.length, 0);

  // a reply that isn't a clean yes (a 429 with a body and no `errors`): never forwarded
  answer = { status: 429, body: { error_message: "Rate limit" } };
  await m.updateColumn("18406060017", "126", "text_mm3ac5a0", "x").catch(() => {});
  assert.equal(m.fridayForward.queue.length, 0, "only Monday's clean yes is forwarded");

  // Friday down: the Monday write returns exactly as before; the forward only retries later
  answer = { status: 200, body: { data: { change_column_value: { id: "43" } } } };
  fridayDown = true;
  assert.deepEqual(await m.updateColumn("18406060017", "127", "text_mm3ac5a0", "y"), { id: "43" });
  await m.fridayForward.tick();
  assert.equal(m.fridayForward.stats.retries, 1);

  // a read is never sent
  answer = { status: 200, body: { data: { items: [] } } };
  await m.mondayQuery("{ items(ids: [1]) { id } }");
  assert.equal(m.fridayForward.queue.length, 1, "only the write waiting to retry");
});
