// Loads the real server (src/index.js) with its three outside connections
// replaced: Monday (src/monday.js), RingCentral (src/sms.js) and the Redis
// client (the ioredis package, so src/redis.js itself still runs). Requests go
// to the app on a loopback port this file opens; nothing leaves the machine.
//
// Not a test file (node --test runs test/*.test.js); the tests require it.
const http = require("node:http");
const path = require("node:path");

const SECRET = "test-webhook-secret-0000000000000000";

// ─── An in-memory stand-in for ioredis: the commands src/redis.js uses ───
const store = { kv: new Map(), hashes: new Map(), lists: new Map() };

class FakeRedis {
  constructor() {}
  on() { return this; }
  async set(key, value, ...args) {
    const nx = args.map((a) => String(a).toUpperCase()).includes("NX");
    if (nx && store.kv.has(key)) return null;
    store.kv.set(key, String(value));
    return "OK";
  }
  async get(key) { return store.kv.has(key) ? store.kv.get(key) : null; }
  async del(key) { store.kv.delete(key); store.hashes.delete(key); store.lists.delete(key); return 1; }
  async exists(key) { return store.kv.has(key) || store.hashes.has(key) || store.lists.has(key) ? 1 : 0; }
  async expire() { return 1; }
  async hmset(key, obj) {
    const h = store.hashes.get(key) || {};
    for (const [k, v] of Object.entries(obj)) h[k] = String(v);
    store.hashes.set(key, h);
    return "OK";
  }
  async hset(key, field, value) { return this.hmset(key, { [field]: value }); }
  async hincrby(key, field, by) {
    const h = store.hashes.get(key) || {};
    h[field] = String(Number(h[field] || 0) + Number(by));
    store.hashes.set(key, h);
    return Number(h[field]);
  }
  async hgetall(key) { return { ...(store.hashes.get(key) || {}) }; }
  async rpush(key, value) {
    const l = store.lists.get(key) || [];
    l.push(String(value));
    store.lists.set(key, l);
    return l.length;
  }
  async lrange(key) { return [...(store.lists.get(key) || [])]; }
  async ping() { return "PONG"; }
}

// ─── Monday: a few items held in memory ───
const items = new Map();
const columnWrites = [];
const monday = {
  async getItem(itemId) { return items.get(String(itemId)) || null; },
  async updateColumn(boardId, itemId, columnId, value) {
    columnWrites.push({ boardId: String(boardId), itemId: String(itemId), columnId, value });
    const item = items.get(String(itemId));
    if (item) {
      const col = item.column_values.find((c) => c.id === columnId);
      if (col) col.text = value; else item.column_values.push({ id: columnId, text: value, value: null });
    }
  },
  async findPatientByUid(uid) {
    for (const item of items.values()) {
      if (item.column_values.some((c) => c.id.startsWith("text_mm3a") && c.text === uid)) {
        return { ...item, boardId: item.board.id };
      }
    }
    return null;
  },
  async mondayQuery() { throw new Error("no Monday in tests"); },
  fridayForward: { status: () => ({}) }
};

// ─── RingCentral: every text is recorded, none sent ───
const texts = [];
let smsResult = { sent: true };
const sms = {
  async sendSMS(phone, message, opts = {}) {
    texts.push({ phone, message, patientName: opts.patientName });
    return smsResult;
  },
  isTestPatient: (name) => String(name).startsWith("[TEST]")
};

function stub(resolvedPath, exports) {
  require.cache[resolvedPath] = { id: resolvedPath, filename: resolvedPath, loaded: true, exports, children: [], paths: [] };
}

process.env.REDIS_URL = "redis://fake-for-tests";
process.env.MONDAY_WEBHOOK_SECRET = SECRET;
delete process.env.WELCOME_TEXTS;

const src = (f) => path.join(__dirname, "..", "src", f);
stub(require.resolve("ioredis", { paths: [src(".")] }), FakeRedis);
stub(require.resolve(src("monday.js")), monday);
stub(require.resolve(src("sms.js")), sms);

const { app } = require("../src/index.js");
const config = require("../src/config.js");

let server = null;
async function start() {
  if (server) return;
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}
async function stop() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
}

function request(method, urlPath, body) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port: server.address().port, method, path: urlPath,
      headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// One Monday webhook delivery, as Monday posts it.
const webhook = (event) => request("POST", `/webhooks/monday/${SECRET}`, { event });

function reset() {
  store.kv.clear(); store.hashes.clear(); store.lists.clear();
  items.clear();
  columnWrites.length = 0;
  texts.length = 0;
  smsResult = { sent: true };
}

module.exports = {
  config, start, stop, reset, request, webhook,
  items, columnWrites, texts, store,
  setSmsResult: (r) => { smsResult = r; }
};
