const express = require("express");
const cors = require("cors");
const { getItem, findPatientByPhone, mondayQuery } = require("./monday");
const { BOARDS, STAGE_COLUMNS, STAGE_MAP, REFERRAL_RECEIVED, MESSAGES, COMPLETED_GROUPS, PHONE_COLUMN } = require("./config");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── Health check ───
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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
    const { boardId, itemId, type } = event;

    // Determine the patient-facing stage
    let patientStage = null;

    if (type === "create_item" && String(boardId) === BOARDS.MEDICAL_EVAL) {
      // New item on Medical Eval board = Referral Received (0B)
      patientStage = REFERRAL_RECEIVED;
      console.log(`[webhook] New patient item ${itemId} → Referral Received`);
    } else if (type === "update_column_value") {
      const columnId = event.columnId;
      const newValue = event.value?.label?.index ?? event.value?.index;
      const stageKey = `${boardId}:${newValue}`;
      patientStage = STAGE_MAP[stageKey];

      if (patientStage) {
        console.log(`[webhook] Item ${itemId} → ${patientStage.code} ${patientStage.label}`);
      } else {
        console.log(`[webhook] Item ${itemId} stage change not mapped: ${stageKey}`);
      }
    } else if (type === "move_item_to_group") {
      // Check if moved to Completed group on Welcome Call
      const groupId = event.destGroupId;
      if (String(boardId) === BOARDS.WELCOME_CALL && groupId === COMPLETED_GROUPS[BOARDS.WELCOME_CALL]) {
        patientStage = STAGE_MAP[`${BOARDS.WELCOME_CALL}:4`]; // Completed
        console.log(`[webhook] Item ${itemId} moved to Completed → You're All Set!`);
      }
    }

    if (patientStage) {
      // TODO: Redis cache update
      // TODO: Notification dispatch (check tier, time gating, send via RingCentral)
      console.log(`[webhook] Stage: ${patientStage.code} | Visible: ${patientStage.visible} | Tier: ${patientStage.tier}`);
      
      if (patientStage.visible && patientStage.tier <= 2) {
        const message = MESSAGES[patientStage.id];
        console.log(`[webhook] 📱 Would send SMS: "${message?.substring(0, 60)}..."`);
      }
    }

    res.json({ status: "received", stage: patientStage?.code || "unmapped" });
  } catch (err) {
    console.error("[webhook] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Patient status endpoint ───
app.get("/api/status/:phone", async (req, res) => {
  try {
    const phone = req.params.phone;
    const boardIds = [BOARDS.WELCOME_CALL, BOARDS.INSURANCE, BOARDS.MEDICAL_EVAL];

    // Search boards in reverse order (latest board = furthest in pipeline)
    const patient = await findPatientByPhone(phone, boardIds);

    if (!patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    // Determine current stage from board + stage advancer value
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

    // If on medical eval with no stage set, they just arrived = referral received
    if (!currentStage && String(patient.boardId) === BOARDS.MEDICAL_EVAL) {
      currentStage = REFERRAL_RECEIVED;
    }

    const intakeCol = patient.column_values.find(c => c.id === "date_mm1wf43j");

    res.json({
      patient: {
        name: patient.name.replace(/^\[TEST\]\s*/, "").split(" ")[0], // First name only for privacy
        itemId: patient.id,
        boardId: patient.boardId,
        group: patient.group?.title
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
    console.error("[status] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── List all items on a board (for debugging) ───
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

app.listen(PORT, () => {
  console.log(`Portal backend running on port ${PORT}`);
  console.log(`Monday token: ${process.env.MONDAY_TOKEN ? "set" : "MISSING"}`);
});
