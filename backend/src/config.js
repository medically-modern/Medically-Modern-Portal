// Monday.com board IDs
const BOARDS = {
  MEDICAL_EVAL: "18406060017",
  INSURANCE: "18410601299",
  WELCOME_CALL: "18410804557",
  SUBSCRIPTION: "18407459988"
};

// Column IDs for stage advancer on each board
const STAGE_COLUMNS = {
  [BOARDS.MEDICAL_EVAL]: "color_mm1wyr92",
  [BOARDS.INSURANCE]: "color_mm1ws96t",
  [BOARDS.WELCOME_CALL]: "color_mm1ws96t"
};

// Phone column (same ID across all boards)
const PHONE_COLUMN = "phone_mm1x44yk";
const PHONE_COLUMN_SUBSCRIPTION = "phone_mkp0q3cw";
const NAME_COLUMN = "name";
const INTAKE_DATE_COLUMN = "date_mm1wf43j";

// Patient UID column IDs (persistent identifier across all boards)
const PATIENT_UID_COLUMNS = {
  [BOARDS.MEDICAL_EVAL]: "text_mm3ac5a0",
  [BOARDS.INSURANCE]: "text_mm3a2b3n",
  [BOARDS.WELCOME_CALL]: "text_mm3av5nt",
  [BOARDS.SUBSCRIPTION]: "text_mm3af3zt"
};

// Map Monday.com (board + stage value index) → patient-facing stage
const STAGE_MAP = {
  // Medical Evaluation board
  [`${BOARDS.MEDICAL_EVAL}:8`]:  { id: "evaluate_mn",       phase: 1, label: "Medical Review In Progress",  visible: false, tier: 3, code: "1A" },
  [`${BOARDS.MEDICAL_EVAL}:9`]:  { id: "send_request",      phase: 1, label: "Working With Your Doctor",     visible: true,  tier: 2, code: "1B", condition: "gt24hrs" },
  [`${BOARDS.MEDICAL_EVAL}:10`]: { id: "confirm_receipt",    phase: 1, label: "Confirming Doctor Received",   visible: false, tier: 3, code: "1C" },
  [`${BOARDS.MEDICAL_EVAL}:11`]: { id: "chase_clinicals",    phase: 1, label: "Awaiting Medical Records",     visible: true,  tier: 2, code: "1D", condition: "gt3days" },
  [`${BOARDS.MEDICAL_EVAL}:14`]: { id: "medical_complete",   phase: 1, label: "Medical Review Complete",      visible: true,  tier: 1, code: "1E" },
  [`${BOARDS.MEDICAL_EVAL}:15`]: { id: "stuck_medical",      phase: 1, label: "Under Review",                 visible: false, tier: 3 },

  // Insurance board
  [`${BOARDS.INSURANCE}:3`]:  { id: "benefits_sos",      phase: 2, label: "Verifying Your Benefits",       visible: false, tier: 3, code: "2A" },
  [`${BOARDS.INSURANCE}:4`]:  { id: "submit_auth",       phase: 2, label: "Submitting Authorization",      visible: false, tier: 3, code: "2B" },
  [`${BOARDS.INSURANCE}:6`]:  { id: "auth_outstanding",  phase: 2, label: "Authorization Pending",         visible: true,  tier: 1, code: "2C" },
  [`${BOARDS.INSURANCE}:0`]:  { id: "auth_denied",       phase: 2, label: "Additional Info Requested",     visible: true,  tier: 2, code: "2D", condition: "always_plus_call" },
  [`${BOARDS.INSURANCE}:7`]:  { id: "insurance_complete", phase: 2, label: "Insurance Approved",            visible: true,  tier: 1, code: "2E" },
  [`${BOARDS.INSURANCE}:2`]:  { id: "stuck_insurance",   phase: 2, label: "Under Review",                  visible: false, tier: 3 },

  // Welcome Call board
  [`${BOARDS.WELCOME_CALL}:7`]: { id: "welcome_call",      phase: 3, label: "Scheduling Your Welcome Call",  visible: true,  tier: 2, code: "3A", condition: "gt24hrs" },
  [`${BOARDS.WELCOME_CALL}:0`]: { id: "review_profile",    phase: 3, label: "Final Profile Confirmation",    visible: false, tier: 3, code: "3B" },
  [`${BOARDS.WELCOME_CALL}:4`]: { id: "completed",         phase: 3, label: "You're All Set!",               visible: true,  tier: 1, code: "3C" },
  [`${BOARDS.WELCOME_CALL}:2`]: { id: "stuck_welcome",     phase: 3, label: "Under Review",                  visible: false, tier: 3 },
};

// Item creation on Medical Eval board = Referral Received (0B)
const REFERRAL_RECEIVED = { id: "referral_received", phase: 0, label: "Referral Received", visible: true, tier: 1, code: "0B" };

// Notification messages
const MESSAGES = {
  referral_received: "We've received your referral and are getting started on your case. We'll keep you updated as we work through the process.",
  send_request: "We're coordinating with your doctor's office to gather the medical documentation needed for your equipment.",
  chase_clinicals: "We're actively following up with your doctor's office to obtain your medical records. This step can sometimes take a few days.",
  medical_complete: "Great news — your medical records have been reviewed and approved. We're now moving to the insurance verification step.",
  auth_outstanding: "Your prior authorization has been submitted to your insurance company. We're waiting on their decision — this typically takes 5–10 business days.",
  auth_denied: "Your insurance has requested additional information before approving your equipment. Our team is working on next steps and will be in touch.",
  insurance_complete: "Your insurance has approved your equipment. We're almost there — a member of our team will reach out soon to finalize everything.",
  welcome_call: "A member of our care team will be calling you soon to go over your equipment, answer any questions, and schedule your delivery.",
  completed: "You're all set! Your equipment order has been placed. You'll receive delivery details shortly. Welcome to Medically Modern!"
};

// Groups that indicate "Completed" on Welcome Call board
const COMPLETED_GROUPS = {
  [BOARDS.WELCOME_CALL]: "group_mm1x5s5d"
};

module.exports = {
  BOARDS, STAGE_COLUMNS, PHONE_COLUMN, PHONE_COLUMN_SUBSCRIPTION, NAME_COLUMN, INTAKE_DATE_COLUMN,
  PATIENT_UID_COLUMNS, STAGE_MAP, REFERRAL_RECEIVED, MESSAGES, COMPLETED_GROUPS
};
