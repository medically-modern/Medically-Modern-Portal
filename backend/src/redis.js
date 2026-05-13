const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL;
let redis = null;

function getRedis() {
  if (!redis && REDIS_URL) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      }
    });
    redis.on("connect", () => console.log("[redis] Connected"));
    redis.on("error", (err) => console.error("[redis] Error:", err.message));
  }
  return redis;
}

// ─── Patient state cache ───
// Key format: patient:{itemId}
// Hash fields match the spec: phone, name, current_stage, board_id, etc.

async function cachePatientState(itemId, state) {
  const r = getRedis();
  if (!r) return null;

  const key = `patient:${itemId}`;
  const data = {
    phone: state.phone || "",
    name: state.name || "",
    current_stage: state.currentStage || "",
    stage_code: state.stageCode || "",
    stage_label: state.stageLabel || "",
    board_id: state.boardId || "",
    item_id: String(itemId),
    stage_updated_at: new Date().toISOString(),
    last_notified_at: state.lastNotifiedAt || "",
    last_notified_stage: state.lastNotifiedStage || "",
    notification_count: String(state.notificationCount || 0),
    intake_date: state.intakeDate || "",
    phase: String(state.phase || 0),
    visible: state.visible ? "true" : "false",
    message: state.message || ""
  };

  await r.hmset(key, data);
  // Expire after 30 days (patients rarely take longer)
  await r.expire(key, 60 * 60 * 24 * 30);
  return data;
}

async function getPatientState(itemId) {
  const r = getRedis();
  if (!r) return null;

  const data = await r.hgetall(`patient:${itemId}`);
  if (!data || !data.item_id) return null;
  return data;
}

// Find patient by phone number in Redis (fast lookup)
async function findPatientByPhoneCache(phone) {
  const r = getRedis();
  if (!r) return null;

  // Normalize to digits and try multiple formats
  const digits = phone.replace(/\D/g, "");
  
  // Try exact digits first
  let itemId = await r.get(`phone:${digits}`);
  
  // If 10 digits (no country code), also try with "1" prefix
  if (!itemId && digits.length === 10) {
    itemId = await r.get(`phone:1${digits}`);
  }
  // If 11 digits starting with 1, also try without country code
  if (!itemId && digits.length === 11 && digits.startsWith("1")) {
    itemId = await r.get(`phone:${digits.slice(1)}`);
  }
  
  if (!itemId) return null;
  return getPatientState(itemId);
}

// Index phone → itemId for fast lookups
async function indexPhone(phone, itemId) {
  const r = getRedis();
  if (!r) return;

  const digits = phone.replace(/\D/g, "");
  if (!digits) return;

  // Store under exact digits
  await r.set(`phone:${digits}`, String(itemId));
  await r.expire(`phone:${digits}`, 60 * 60 * 24 * 30);

  // Also store the alternate format (with/without country code)
  if (digits.length === 11 && digits.startsWith("1")) {
    await r.set(`phone:${digits.slice(1)}`, String(itemId));
    await r.expire(`phone:${digits.slice(1)}`, 60 * 60 * 24 * 30);
  } else if (digits.length === 10) {
    await r.set(`phone:1${digits}`, String(itemId));
    await r.expire(`phone:1${digits}`, 60 * 60 * 24 * 30);
  }
}

// ─── Notification history ───
// Append-only log per patient

async function logNotification(itemId, stageCode, message) {
  const r = getRedis();
  if (!r) return;

  const entry = JSON.stringify({
    stage: stageCode,
    message: message.substring(0, 100),
    timestamp: new Date().toISOString()
  });

  await r.rpush(`notifications:${itemId}`, entry);
  await r.expire(`notifications:${itemId}`, 60 * 60 * 24 * 90); // 90 day retention

  // Update notification count and last notified
  await r.hincrby(`patient:${itemId}`, "notification_count", 1);
  await r.hset(`patient:${itemId}`, "last_notified_at", new Date().toISOString());
  await r.hset(`patient:${itemId}`, "last_notified_stage", stageCode);
}

async function getNotificationHistory(itemId) {
  const r = getRedis();
  if (!r) return [];

  const entries = await r.lrange(`notifications:${itemId}`, 0, -1);
  return entries.map(e => JSON.parse(e));
}

// ─── Health check ───
async function redisHealthCheck() {
  const r = getRedis();
  if (!r) return { connected: false, reason: "no_url" };
  try {
    await r.ping();
    return { connected: true };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

module.exports = {
  getRedis, cachePatientState, getPatientState,
  findPatientByPhoneCache, indexPhone,
  logNotification, getNotificationHistory,
  redisHealthCheck
};
