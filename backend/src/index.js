const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { getItem, findPatientByUid, mondayQuery, updateColumn } = require("./monday");
const { BOARDS, PORTAL_BASE_URL, STAGE_COLUMNS, STAGE_MAP, REFERRAL_RECEIVED, MESSAGES, COMPLETED_GROUPS, PATIENT_UID_COLUMNS } = require("./config");
const { cachePatientState, getPatientState, findPatientByUidCache, indexPhone, indexUid, logNotification, getNotificationHistory, redisHealthCheck } = require("./redis");
const { sendSMS, isTestPatient } = require("./sms");

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

// Load portal HTML template for serving with dynamic OG tags
let PORTAL_HTML = "";
try {
  PORTAL_HTML = fs.readFileSync(path.join(__dirname, "portal.html"), "utf8");
  console.log("[portal] HTML template loaded");
} catch (e) {
  console.log("[portal] portal.html not found — /portal route will not work");
}

const app = express();

// ─── [#6] Security headers ───
app.use(helmet());

// ─── [#6] CORS — restrict to known origins ───
const ALLOWED_ORIGINS = [
  "https://medicallymodern.com",
  "https://www.medicallymodern.com",
  "https://patient-portal-backend-production.up.railway.app"
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, curl, mobile)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("CORS not allowed"));
  }
}));

app.use(express.json());

// ─── [#6] Global rate limiter — 100 req/min/IP ───
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" }
}));

// ─── [#4] Strict rate limiter for status endpoints — 30 req/min/IP ───
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many status requests, please try again later" }
});

// ─── [#2] Debug endpoint auth middleware ───
const DEBUG_API_KEY = process.env.DEBUG_API_KEY;
function requireDebugKey(req, res, next) {
  if (!DEBUG_API_KEY) {
    return res.status(503).json({ error: "Debug endpoints are disabled (no DEBUG_API_KEY configured)" });
  }
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${DEBUG_API_KEY}`) {
    console.log(`[security] Unauthorized debug access attempt from ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const PORT = process.env.PORT || 3000;

// ─── Health check ───
// ─── [#7] Health check — no internal config details ───
app.get("/health", async (req, res) => {
  const redis = await redisHealthCheck();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    redis: redis.connected ? "connected" : "disconnected"
  });
});

// ─── [#1] Webhook receiver from Monday.com — URL-based secret verification ───
// The webhook URL is: /webhooks/monday/{MONDAY_WEBHOOK_SECRET}
// Monday.com stores the full URL when the webhook is created. An attacker would
// need to know the 64-char hex secret embedded in the URL to send crafted payloads.
// The secret is stored as MONDAY_WEBHOOK_SECRET on Railway and never exposed client-side.
app.post("/webhooks/monday/:secret", async (req, res) => {
  // Verify the URL secret before doing anything (including challenge response)
  const expectedSecret = process.env.MONDAY_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("[security] MONDAY_WEBHOOK_SECRET not configured — rejecting all webhooks");
    return res.status(503).json({ error: "Webhook endpoint not configured" });
  }
  if (!crypto.timingSafeEqual(Buffer.from(req.params.secret), Buffer.from(expectedSecret))) {
    console.log(`[security] Webhook request with invalid secret from ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Monday sends a challenge on first subscription
  if (req.body.challenge) {
    console.log("[webhook] Challenge received, responding");
    return res.json({ challenge: req.body.challenge });
  }

  const event = req.body.event;
  if (!event) {
    return res.status(400).json({ error: "No event data" });
  }

  console.log("[webhook] Event received:", JSON.stringify(event, null, 2));

  try {
    const { boardId, pulseId, type } = event;
    const itemId = pulseId || event.itemId; // Monday uses pulseId in webhooks

    // Determine the patient-facing stage
    let patientStage = null;

    if (type === "create_item" && String(boardId) === BOARDS.MEDICAL_EVAL) {
      patientStage = REFERRAL_RECEIVED;

      // Generate and assign a persistent patient UID
      const patientUid = crypto.randomUUID();
      const uidColumnId = PATIENT_UID_COLUMNS[BOARDS.MEDICAL_EVAL];
      try {
        await updateColumn(BOARDS.MEDICAL_EVAL, itemId, uidColumnId, patientUid);
        console.log(`[webhook] New patient item ${itemId} → Referral Received | UID: ${patientUid}`);
      } catch (uidErr) {
        console.error(`[webhook] Failed to write patient UID to Monday: ${uidErr.message}`);
        // Continue processing — UID write failure shouldn't block the webhook
      }
    } else if (type === "update_column_value") {
      // Only process stage advancer column changes
      const columnId = event.columnId;
      const expectedColumn = STAGE_COLUMNS[String(boardId)];
      if (expectedColumn && columnId !== expectedColumn) {
        console.log(`[webhook] Ignoring column ${columnId} (not stage advancer ${expectedColumn})`);
        return res.json({ status: "ignored", reason: "non-stage-column" });
      }

      // Monday may send value as string or object
      let eventValue = event.value;
      if (typeof eventValue === "string") {
        try { eventValue = JSON.parse(eventValue); } catch(e) {}
      }
      const newValue = eventValue?.label?.index ?? eventValue?.index;
      const stageKey = `${boardId}:${newValue}`;
      patientStage = STAGE_MAP[stageKey];

      if (patientStage) {
        console.log(`[webhook] Item ${itemId} → ${patientStage.code} ${patientStage.label}`);
      } else {
        console.log(`[webhook] Item ${itemId} stage change not mapped: ${stageKey}`);
      }
    } else if (type === "move_item_to_group") {
      const groupId = event.destGroupId;
      if (String(boardId) === BOARDS.WELCOME_CALL && groupId === COMPLETED_GROUPS[BOARDS.WELCOME_CALL]) {
        patientStage = STAGE_MAP[`${BOARDS.WELCOME_CALL}:4`];
        console.log(`[webhook] Item ${itemId} moved to Completed → You're All Set!`);
      }
    }

    if (patientStage) {
      // Fetch item details from Monday for caching
      const item = await getItem(itemId);
      const phoneCol = item?.column_values?.find(c => c.id === "phone_mm1x44yk");
      const intakeCol = item?.column_values?.find(c => c.id === "date_mm1wf43j");
      const uidCol = item?.column_values?.find(c => Object.values(PATIENT_UID_COLUMNS).includes(c.id));
      const phone = phoneCol?.text || "";
      const patientName = item?.name || "";
      let patientUid = uidCol?.text || "";

      // If item has no UID yet (e.g. created by Monday automation, not direct creation),
      // assign one now. This is the fallback for when create_item webhook doesn't fire.
      if (!patientUid) {
        patientUid = crypto.randomUUID();
        const uidColumnId = PATIENT_UID_COLUMNS[String(boardId)];
        if (uidColumnId) {
          try {
            await updateColumn(String(boardId), itemId, uidColumnId, patientUid);
            console.log(`[webhook] Auto-assigned UID ${patientUid} to item ${itemId} (no create_item event received)`);
          } catch (uidErr) {
            console.error(`[webhook] Failed to auto-assign UID: ${uidErr.message}`);
            patientUid = ""; // Don't use a UID we couldn't persist
          }
        }

        // If this is the first time we see this item on the Medical Eval board,
        // also fire the 0B (Referral Received) notification — the create_item
        // webhook was missed, so the patient never got their initial text.
        if (String(boardId) === BOARDS.MEDICAL_EVAL && patientStage.code !== "0B") {
          console.log(`[webhook] Automation-created item detected on Medical Eval — sending retroactive 0B notification`);
          const msg0B = MESSAGES[REFERRAL_RECEIVED.id];
          if (msg0B && phone) {
            let fullMsg0B = msg0B;
            if (patientUid) {
              fullMsg0B += `\n\nTrack your progress: ${PORTAL_BASE_URL}?p=${patientUid}`;
            }
            const sms0B = await sendSMS(phone, fullMsg0B, { patientName });
            await logNotification(itemId, "0B", msg0B);
            console.log(`[webhook] Retroactive 0B SMS: ${sms0B.sent ? "SENT" : sms0B.reason}`);
          }
        }
      }

      // Update Redis cache
      await cachePatientState(itemId, {
        phone,
        name: patientName,
        currentStage: patientStage.id,
        stageCode: patientStage.code,
        stageLabel: patientStage.label,
        boardId: String(boardId),
        phase: patientStage.phase,
        visible: patientStage.visible,
        message: MESSAGES[patientStage.id] || "",
        intakeDate: intakeCol?.text || "",
        patientUid
      });

      // Index phone and UID for fast lookups
      if (phone) await indexPhone(phone, itemId);
      if (patientUid) await indexUid(patientUid, itemId);

      console.log(`[webhook] Cached: ${patientStage.code} | Visible: ${patientStage.visible} | Tier: ${patientStage.tier}`);

      // Notification dispatch
      if (patientStage.visible && patientStage.tier <= 2) {
        const message = MESSAGES[patientStage.id];

        // Send on every tier 1 and tier 2 advancement
        // TODO: re-enable time gating (gt24hrs, gt3days) when going to production
        const shouldSend = true;

        if (shouldSend && message) {
          // Append portal link with patient UID
          let fullMessage = message;
          if (patientUid) {
            fullMessage += `\n\nTrack your progress: ${PORTAL_BASE_URL}?p=${patientUid}`;
          }
          const smsResult = await sendSMS(phone, fullMessage, { patientName });
          await logNotification(itemId, patientStage.code, message);
          console.log(`[webhook] SMS: ${smsResult.sent ? "SENT" : smsResult.reason} → ${patientStage.code}`);
        } else {
          console.log(`[webhook] SMS skipped (conditional tier, too recent)`);
        }
      }
    }

    res.json({ status: "received", stage: patientStage?.code || "unmapped" });
  } catch (err) {
    console.error("[webhook] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── [#3] Phone lookup endpoint REMOVED — was unauthenticated, allowed enumeration ───
// The portal frontend uses UID-based lookup only. Phone lookup is no longer exposed.

// ─── [#4, #7] Patient status by UID (portal link: ?p={patient_uid}) ───
// Rate limited + response minimized to only what the frontend needs
app.get("/api/status/uid/:uid", statusLimiter, async (req, res) => {
  try {
    const uid = req.params.uid;

    // [#4] Validate UUID format before touching Redis or Monday
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(uid)) {
      return res.status(400).json({ error: "Invalid patient identifier" });
    }

    // Try Redis cache first
    const cached = await findPatientByUidCache(uid);
    if (cached) {
      console.log(`[status] UID cache HIT for ${uid}`);
      return res.json({
        patient: {
          name: cached.name.replace(/^\[TEST\]\s*/, "").split(" ")[0]
        },
        stage: {
          code: cached.stage_code,
          label: cached.stage_label,
          phase: parseInt(cached.phase),
          visible: cached.visible === "true",
          message: cached.message
        },
        intakeDate: cached.intake_date || null,
        lastUpdated: cached.stage_updated_at
      });
    }

    // Cache miss — search Monday.com boards for this UID
    console.log(`[status] UID cache MISS for ${uid}, querying Monday.com`);
    const patient = await findPatientByUid(uid);

    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const stageCol = patient.column_values.find(c =>
      c.id === "color_mm1wyr92" || c.id === "color_mm1ws96t"
    );

    let currentStage = null;
    if (stageCol?.value) {
      try {
        const parsed = JSON.parse(stageCol.value);
        const stageKey = `${patient.boardId}:${parsed.index}`;
        currentStage = STAGE_MAP[stageKey];
      } catch (e) {
        console.log("Could not parse stage column:", stageCol.value);
      }
    }

    if (!currentStage && String(patient.boardId) === BOARDS.MEDICAL_EVAL) {
      currentStage = REFERRAL_RECEIVED;
    }

    const intakeCol = patient.column_values.find(c => c.id === "date_mm1wf43j");
    const phoneCol = patient.column_values.find(c => c.id === "phone_mm1x44yk");

    // Hydrate cache
    if (currentStage) {
      await cachePatientState(patient.id, {
        phone: phoneCol?.text || "",
        name: patient.name,
        currentStage: currentStage.id,
        stageCode: currentStage.code,
        stageLabel: currentStage.label,
        boardId: patient.boardId,
        phase: currentStage.phase,
        visible: currentStage.visible,
        message: MESSAGES[currentStage.id] || "",
        intakeDate: intakeCol?.text || "",
        patientUid: uid
      });
      if (phoneCol?.text) await indexPhone(phoneCol.text, patient.id);
      await indexUid(uid, patient.id);
    }

    // [#7] Only return what the frontend needs — no itemId, boardId, group, source
    res.json({
      patient: {
        name: patient.name.replace(/^\[TEST\]\s*/, "").split(" ")[0]
      },
      stage: currentStage ? {
        code: currentStage.code,
        label: currentStage.label,
        phase: currentStage.phase,
        visible: currentStage.visible,
        message: MESSAGES[currentStage.id]
      } : null,
      intakeDate: intakeCol?.text || null,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    console.error("[status/uid] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── [#2] Debug endpoints — protected by API key ───
app.get("/api/debug/board/:boardId", requireDebugKey, async (req, res) => {
  try {
    // [#5] Validate board ID is numeric only
    const boardId = req.params.boardId;
    if (!/^\d+$/.test(boardId)) {
      return res.status(400).json({ error: "Invalid board ID" });
    }
    const data = await mondayQuery(`{
      boards(ids: [${boardId}]) {
        name
        items_page(limit: 25) {
          items {
            id name group { id title }
            column_values(ids: ["phone_mm1x44yk", "color_mm1wyr92", "color_mm1ws96t", "date_mm1wf43j"]) {
              id text
            }
          }
        }
      }
    }`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/debug/cache/:itemId", requireDebugKey, async (req, res) => {
  try {
    // [#5] Validate item ID is numeric only
    const itemId = req.params.itemId;
    if (!/^\d+$/.test(itemId)) {
      return res.status(400).json({ error: "Invalid item ID" });
    }
    const state = await getPatientState(itemId);
    const history = await getNotificationHistory(itemId);
    res.json({ cached: state, notifications: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ─── OG Preview Images (pre-generated on startup — one PNG per stage) ───
const OG_STAGE_ORDER = ["0B","1B","1D","1E","2C","2D","2E","3A","3C"];
const NON_VISIBLE_MAP = { "1A": 0, "1C": 2, "2A": 4, "2B": 4, "3B": 8 };
const ogImageCache = {}; // stage index → PNG buffer

function buildOgSvg(activeIdx) {
  const W = 1200, H = 630;
  const dotR = 16, dotSpacing = 105, dotStartX = 145, dotY = 340;

  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  // Gradient background
  svg += `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`;
  svg += `<stop offset="0%" stop-color="#0B6E4F"/><stop offset="100%" stop-color="#2196A4"/>`;
  svg += `</linearGradient></defs>`;
  svg += `<rect width="${W}" height="${H}" fill="url(#g)"/>`;
  // Decorative circles
  svg += `<circle cx="1080" cy="80" r="200" fill="rgba(255,255,255,0.04)"/>`;
  svg += `<circle cx="120" cy="560" r="150" fill="rgba(255,255,255,0.03)"/>`;

  // Progress dots
  for (let i = 0; i < 9; i++) {
    const cx = dotStartX + i * dotSpacing;
    const done = i < activeIdx;
    const active = i === activeIdx;

    // Connector line
    if (i > 0) {
      const prevCx = dotStartX + (i - 1) * dotSpacing;
      const color = i <= activeIdx ? "#4ADE80" : "rgba(255,255,255,0.2)";
      svg += `<rect x="${prevCx + dotR + 6}" y="${dotY - 2}" width="${dotSpacing - 2 * dotR - 12}" height="4" rx="2" fill="${color}"/>`;
    }

    if (active) {
      svg += `<circle cx="${cx}" cy="${dotY}" r="${dotR + 4}" fill="none" stroke="#4ADE80" stroke-width="3"/>`;
      svg += `<circle cx="${cx}" cy="${dotY}" r="${dotR}" fill="white"/>`;
      svg += `<circle cx="${cx}" cy="${dotY}" r="6" fill="#0B6E4F"/>`;
    } else if (done) {
      svg += `<circle cx="${cx}" cy="${dotY}" r="${dotR}" fill="#4ADE80"/>`;
      svg += `<path d="M${cx-6} ${dotY} L${cx-1} ${dotY+5} L${cx+7} ${dotY-5}" fill="none" stroke="#064A35" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      svg += `<circle cx="${cx}" cy="${dotY}" r="${dotR}" fill="rgba(255,255,255,0.2)"/>`;
    }
  }

  // Phase separators
  svg += `<rect x="${dotStartX + 3*dotSpacing + dotR + 20}" y="${dotY-30}" width="2" height="60" rx="1" fill="rgba(255,255,255,0.15)"/>`;
  svg += `<rect x="${dotStartX + 6*dotSpacing + dotR + 20}" y="${dotY-30}" width="2" height="60" rx="1" fill="rgba(255,255,255,0.15)"/>`;

  // Progress bar
  const barW = W - 160;
  svg += `<rect x="80" y="${H-60}" width="${barW}" height="8" rx="4" fill="rgba(255,255,255,0.15)"/>`;
  svg += `<rect x="80" y="${H-60}" width="${Math.round(barW * ((activeIdx+1)/9))}" height="8" rx="4" fill="#4ADE80"/>`;

  svg += `</svg>`;
  return Buffer.from(svg);
}

// Pre-generate all 9 stage images + 1 default on startup
async function preGenerateOgImages() {
  try {
    for (let i = 0; i < 9; i++) {
      const svgBuf = buildOgSvg(i);
      ogImageCache[i] = await sharp(svgBuf).png().toBuffer();
      console.log(`[og-image] Pre-generated stage ${i} (${OG_STAGE_ORDER[i]}): ${ogImageCache[i].length} bytes`);
    }
    // Default image (no active stage — all dim)
    const defaultSvg = buildOgSvg(-1);
    ogImageCache[-1] = await sharp(defaultSvg).png().toBuffer();
    console.log(`[og-image] Pre-generated default: ${ogImageCache[-1].length} bytes`);
    console.log("[og-image] All 10 images ready");
  } catch (err) {
    console.error("[og-image] Pre-generation failed:", err.message);
  }
}

app.get("/og-image.png", async (req, res) => {
  const uid = req.query.p;
  let activeIdx = -1;

  if (uid) {
    try {
      const cached = await findPatientByUidCache(uid);
      if (cached) {
        const code = cached.stage_code || "0B";
        activeIdx = OG_STAGE_ORDER.indexOf(code);
        if (activeIdx === -1) activeIdx = NON_VISIBLE_MAP[code] ?? 0;
      }
    } catch (e) {
      console.error("[og-image] Lookup error:", e.message);
    }
  }

  const png = ogImageCache[activeIdx] || ogImageCache[-1];
  if (png) {
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=300");
    res.send(png);
  } else {
    // Images not ready yet (server just started)
    res.set("Content-Type", "image/svg+xml");
    res.send(buildOgSvg(activeIdx));
  }
});

// ─── Portal page with dynamic Open Graph meta for iPhone previews ───
app.get("/portal", async (req, res) => {
  const uid = req.query.p;
  
  let ogTitle = "Medically Modern — Patient Portal";
  let ogDescription = "Check your onboarding progress and stay updated on your equipment order.";
  let ogImage = uid
    ? `https://patient-portal-backend-production.up.railway.app/og-image.png?p=${uid}`
    : "https://patient-portal-backend-production.up.railway.app/og-image.png";
  
  if (uid) {
    try {
      // Try cache first, then Monday
      let patient = await findPatientByUidCache(uid);
      if (!patient) {
        const mondayPatient = await findPatientByUid(uid);
        if (mondayPatient) {
          const stageCol = mondayPatient.column_values.find(c =>
            c.id === "color_mm1wyr92" || c.id === "color_mm1ws96t"
          );
          let currentStage = null;
          if (stageCol?.value) {
            try {
              const parsed = JSON.parse(stageCol.value);
              const stageKey = `${mondayPatient.boardId}:${parsed.index}`;
              currentStage = STAGE_MAP[stageKey];
            } catch (e) {}
          }
          if (!currentStage) currentStage = REFERRAL_RECEIVED;
          patient = {
            name: mondayPatient.name,
            stage_label: currentStage.label,
            stage_code: currentStage.code,
            phase: String(currentStage.phase),
            message: MESSAGES[currentStage.id] || ""
          };
        }
      }
      
      if (patient) {
        const name = (patient.name || "").replace(/^\[TEST\]\s*/, "").split(" ")[0];
        const stageLabel = patient.stage_label || "In Progress";
        const phase = parseInt(patient.phase || "0");
        
        // Count progress
        const allStages = 9; // total visible stages
        const stageOrder = ["0B","1B","1D","1E","2C","2D","2E","3A","3C"];
        const code = patient.stage_code || "0B";
        let stageIdx = stageOrder.indexOf(code);
        if (stageIdx === -1) {
          // Non-visible stage, approximate
          const mapping = { "1A": 0, "1C": 2, "2A": 4, "2B": 4, "3B": 8 };
          stageIdx = mapping[code] ?? 0;
        }
        const stepNum = stageIdx + 1;
        
        ogTitle = name ? `${name} — ${stageLabel}` : stageLabel;
        ogDescription = `Step ${stepNum} of ${allStages}: ${patient.message || stageLabel}`;
      }
    } catch (err) {
      console.error("[portal] OG lookup error:", err.message);
    }
  }
  
  // Serve the frontend HTML with injected OG meta tags
  const ogTags = `
    <meta property="og:type" content="website">
    <meta property="og:title" content="${ogTitle.replace(/"/g, '&quot;')}">
    <meta property="og:description" content="${ogDescription.replace(/"/g, '&quot;')}">
    <meta property="og:site_name" content="Medically Modern">
    <meta property="og:image" content="${ogImage}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${ogTitle.replace(/"/g, '&quot;')}">
    <meta name="twitter:description" content="${ogDescription.replace(/"/g, '&quot;')}">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="Medically Modern">
  `;
  
  // Read the HTML template and inject OG tags after <head>
  const html = PORTAL_HTML.replace('<head>', '<head>' + ogTags);
  
  res.set('Content-Type', 'text/html');
  res.send(html);
});

app.listen(PORT, async () => {
  console.log(`Portal backend running on port ${PORT}`);
  console.log(`Monday: ${process.env.MONDAY_TOKEN ? "configured" : "MISSING"}`);
  console.log(`Redis: ${process.env.REDIS_URL ? "configured" : "MISSING (will fall back to Monday API)"}`);
  // Pre-generate OG preview images (10 PNGs cached in memory)
  await preGenerateOgImages();
});
