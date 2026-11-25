// The Friday read shadow is wired, not just written: mondayQuery hands a READ to Friday's /v2/shadow only after Monday
// answered it 2xx with data and no errors, on a later turn, never awaited; never a mutation, a refusal, a reply that
// isn't a clean yes, or the webhook setup's own read (forwardToFriday: false). Monday and Friday are stubs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const src = (f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

test("monday.js hands the read over once, inside the clean-yes guard, after the error check, in its own try, never awaited", () => {
  const m = src("monday.js");
  assert.match(m, /const fridayShadow = createFridayShadow\(\{ env: process\.env, log: \(m\) => console\.log\(m\), reader: "patient-intake-texts-backend" \}\);/);
  const q = m.slice(m.indexOf("async function mondayQuery("), m.indexOf("// Get a single item by ID"));
  const guard = q.indexOf("if (forwardToFriday && res.ok && data && data.data) {");
  const hook = q.indexOf("try { fridayShadow.onRead({");
  assert.ok(guard > q.indexOf("if (data.errors)") && hook > guard && hook < q.indexOf("return data.data;"));
  assert.equal((m.match(/fridayShadow\.onRead/g) || []).length, 1, "one hook");
  assert.doesNotMatch(m, /await\s+fridayShadow/, "never awaited");
  assert.doesNotMatch(src("fridayShadow.js"), /api\.monday\.com/, "the shadow names no Monday address");
  assert.match(src("index.js"), /friday_shadow: fridayShadow\.health\(\)/);
});

test("a read reaches Friday after the caller has its answer; nothing else does", async () => {
  process.env.FRIDAY_SHADOW = "1";
  process.env.FRIDAY_URL = "https://friday.test";
  process.env.FRIDAY_API_KEY = "fk_live_test";
  delete process.env.FRIDAY_FORWARD;
  delete process.env.MONDAY_API_URL;
  const monday = [], shadow = [];
  let answer = null;
  global.fetch = async (url, init) => {
    if (String(url) === "https://friday.test/v2/shadow") {
      shadow.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ outcome: "same" }), { status: 200 });
    }
    if (!String(url).startsWith("https://api.monday.com")) throw new Error(`unexpected fetch ${url}`);
    monday.push(JSON.parse(init.body));
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  };
  delete require.cache[require.resolve("../src/monday.js")];
  const m = require("../src/monday.js");
  m.fridayForward.stop();
  assert.equal(m.fridayShadow.enabled, true);

  const item = { id: "123", name: "x", board: { id: "18406060017" }, group: { id: "g", title: "G" }, column_values: [] };
  answer = { status: 200, body: { data: { items: [item] } } };
  assert.deepEqual(await m.getItem("123"), item, "the caller gets Monday's answer, unchanged");
  assert.equal(shadow.length, 0, "nothing handed over in the caller's turn");
  await settle();
  assert.equal(shadow.length, 1);
  assert.equal(shadow[0].reader, "patient-intake-texts-backend");
  assert.equal(shadow[0].query, monday[0].query);
  assert.deepEqual(shadow[0].monday.body, { data: { items: [item] } });

  // a mutation Monday took, a refused read, a 429 with no `errors`, and the webhook setup's read: never handed over
  answer = { status: 200, body: { data: { change_column_value: { id: "42" } } } };
  await m.updateColumn("18406060017", "123", "text_mm3ac5a0", "x");
  answer = { status: 200, body: { errors: [{ message: "bad column" }] } };
  await assert.rejects(m.getItem("124"));
  answer = { status: 429, body: { error_message: "Rate limit" } };
  await m.getItem("125").catch(() => {});
  answer = { status: 200, body: { data: { webhooks: [] } } };
  await m.mondayQuery("query ($board_id: ID!) { webhooks(board_id: $board_id) { id event config } }", { board_id: "18410804557" }, { forwardToFriday: false });
  await settle();
  assert.equal(shadow.length, 1, "only the clean read was handed over");
  assert.equal(m.fridayShadow.health().stats.same, 1);
});
