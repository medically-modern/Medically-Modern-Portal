const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { getItem, findPatientByPhone, findPatientByUid, mondayQuery, updateColumn } = require("./monday");
const { BOARDS, PORTAL_BASE_URL, STAGE_COLUMNS, STAGE_MAP, REFERRAL_RECEIVED, MESSAGES, COMPLETED_GROUPS, PATIENT_UID_COLUMNS } = require("./config");
const { cachePatientState, getPatientState, findPatientByPhoneCache, findPatientByUidCache, indexPhone, indexUid, logNotification, getNotificationHistory, redisHealthCheck } = require("./redis");
const { sendSMS, isTestPatient } = require("./sms");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── Health check ───
app.get("/health", async (req, res) => {
  const redis = await redisHealthCheck();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    redis: redis.connected ? "connected" : `disconnected (${redis.reason})`,
    monday: process.env.MONDAY_TOKEN ? "configured" : "MISSING"
  });
});

// ─── Webhook receiver from Monday.com ───
app.post("/webhooks/monday", async (req, res) => {
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
              fullMsg0B += `\n\nTrack your progress: ${PORTAL_BASE_URL}/?p=${patientUid}`;
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
            fullMessage += `\n\nTrack your progress: ${PORTAL_BASE_URL}/?p=${patientUid}`;
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
    res.status(500).json({ error: err.message });
  }
});

// ─── Patient status by phone ───
app.get("/api/status/:phone", async (req, res) => {
  try {
    const phone = req.params.phone;

    // Try Redis cache first (fast path)
    const cached = await findPatientByPhoneCache(phone);
    if (cached) {
      console.log(`[status] Phone cache HIT for ${phone}`);
      const history = await getNotificationHistory(cached.item_id);
      return res.json({
        patient: {
          name: cached.name.replace(/^\[TEST\]\s*/, "").split(" ")[0],
          itemId: cached.item_id,
          boardId: cached.board_id,
          uid: cached.patient_uid || null
        },
        stage: {
          code: cached.stage_code,
          label: cached.stage_label,
          phase: parseInt(cached.phase),
          visible: cached.visible === "true",
          message: cached.message
        },
        intakeDate: cached.intake_date || null,
        notifications: { count: parseInt(cached.notification_count || 0), history },
        lastUpdated: cached.stage_updated_at,
        source: "cache"
      });
    }

    // Cache miss — fall back to Monday.com API
    console.log(`[status] Phone cache MISS for ${phone}, querying Monday.com`);
    const boardIds = [BOARDS.WELCOME_CALL, BOARDS.INSURANCE, BOARDS.MEDICAL_EVAL];
    const patient = await findPatientByPhone(phone, boardIds);

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
    const uidCol = patient.column_values.find(c => Object.values(PATIENT_UID_COLUMNS).includes(c.id));

    // Hydrate Redis cache
    if (currentStage) {
      await cachePatientState(patient.id, {
        phone: phoneCol?.text || phone,
        name: patient.name,
        currentStage: currentStage.id,
        stageCode: currentStage.code,
        stageLabel: currentStage.label,
        boardId: patient.boardId,
        phase: currentStage.phase,
        visible: currentStage.visible,
        message: MESSAGES[currentStage.id] || "",
        intakeDate: intakeCol?.text || "",
        patientUid: uidCol?.text || ""
      });
      if (phoneCol?.text) await indexPhone(phoneCol.text, patient.id);
      if (uidCol?.text) await indexUid(uidCol.text, patient.id);
    }

    res.json({
      patient: {
        name: patient.name.replace(/^\[TEST\]\s*/, "").split(" ")[0],
        itemId: patient.id,
        boardId: patient.boardId,
        group: patient.group?.title,
        uid: uidCol?.text || null
      },
      stage: currentStage ? {
        code: currentStage.code,
        label: currentStage.label,
        phase: currentStage.phase,
        visible: currentStage.visible,
        message: MESSAGES[currentStage.id]
      } : null,
      intakeDate: intakeCol?.text || null,
      lastUpdated: new Date().toISOString(),
      source: "monday_api"
    });
  } catch (err) {
    console.error("[status/phone] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Patient status by UID (portal link: ?p={patient_uid}) ───
app.get("/api/status/uid/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    // Try Redis cache first
    const cached = await findPatientByUidCache(uid);
    if (cached) {
      console.log(`[status] UID cache HIT for ${uid}`);
      const history = await getNotificationHistory(cached.item_id);
      return res.json({
        patient: {
          name: cached.name.replace(/^\[TEST\]\s*/, "").split(" ")[0],
          itemId: cached.item_id,
          boardId: cached.board_id,
          uid
        },
        stage: {
          code: cached.stage_code,
          label: cached.stage_label,
          phase: parseInt(cached.phase),
          visible: cached.visible === "true",
          message: cached.message
        },
        intakeDate: cached.intake_date || null,
        notifications: { count: parseInt(cached.notification_count || 0), history },
        lastUpdated: cached.stage_updated_at,
        source: "cache"
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

    res.json({
      patient: {
        name: patient.name.replace(/^\[TEST\]\s*/, "").split(" ")[0],
        itemId: patient.id,
        boardId: patient.boardId,
        group: patient.group?.title,
        uid
      },
      stage: currentStage ? {
        code: currentStage.code,
        label: currentStage.label,
        phase: currentStage.phase,
        visible: currentStage.visible,
        message: MESSAGES[currentStage.id]
      } : null,
      intakeDate: intakeCol?.text || null,
      lastUpdated: new Date().toISOString(),
      source: "monday_api"
    });
  } catch (err) {
    console.error("[status/uid] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Debug endpoints ───
app.get("/api/debug/board/:boardId", async (req, res) => {
  try {
    const data = await mondayQuery(`{
      boards(ids: [${req.params.boardId}]) {
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

app.get("/api/debug/cache/:itemId", async (req, res) => {
  try {
    const state = await getPatientState(req.params.itemId);
    const history = await getNotificationHistory(req.params.itemId);
    res.json({ cached: state, notifications: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Portal backend running on port ${PORT}`);
  console.log(`Monday: ${process.env.MONDAY_TOKEN ? "configured" : "MISSING"}`);
  console.log(`Redis: ${process.env.REDIS_URL ? "configured" : "MISSING (will fall back to Monday API)"}`);
});
