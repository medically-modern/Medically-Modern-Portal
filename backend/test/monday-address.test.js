// Monday's address is a setting (MONDAY_API_URL) whose default is today's address, so the January
// cutover to Friday is one variable and nothing changes until then.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const MOD = require.resolve("../src/monday.js");

async function urlUsed(env) {
  const saved = { a: process.env.MONDAY_API_URL, ff: process.env.FRIDAY_FORWARD };
  delete process.env.MONDAY_API_URL; delete process.env.FRIDAY_FORWARD;
  Object.assign(process.env, env);
  delete require.cache[MOD];
  const realFetch = global.fetch;
  let url = null;
  global.fetch = async (u) => { url = String(u); return new Response(JSON.stringify({ data: { me: { id: "1" } } }), { status: 200, headers: { "content-type": "application/json" } }); };
  try {
    const m = require(MOD);
    m.fridayForward.stop();
    await m.mondayQuery("query { me { id } }");
    return url;
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of [["MONDAY_API_URL", saved.a], ["FRIDAY_FORWARD", saved.ff]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[MOD];
  }
}

test("unset, the client calls Monday's own address", async () => {
  assert.equal(await urlUsed({}), "https://api.monday.com/v2");
});

test("MONDAY_API_URL is read", async () => {
  assert.equal(await urlUsed({ MONDAY_API_URL: "https://friday.example/v2" }), "https://friday.example/v2");
});
