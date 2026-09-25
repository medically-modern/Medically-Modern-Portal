// Portal frontend URL
const PORTAL_BASE_URL = "https://medicallymodern.com/portal";

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

// Referral Source (Medical Evaluation board) — gates the intake text below.
const REFERRAL_SOURCE_COLUMN = "color_mm1w5wxr";

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

// Columns the doctor's script is filled from (Medical Evaluation board).
// Patient and device only: this board also holds a Doctor Name and NPI, but the
// script goes out with the physician block blank for the prescriber to complete
// — see script.js. Where a value is missing pdf.js rules a line, so a thin
// record degrades on its own.
const SCRIPT_COLUMNS = {
  dob:      "text_mm1xvxst",
  cgmType:  "color_mm1w7pmf",
  pumpType: "color_mm1wjjtk"
};

// Both device columns carry this label when we are not serving that device. It
// is the "no script of this kind" signal — more reliable than Request Type,
// which says "Supplies Only" for patients who do have a pump on record.
const DEVICE_NOT_SERVED = "Not Serving";

// The script is a nudge to get clinicals moving, so it lives on the tracker only
// while that is still the open question. Phase 2 is insurance: by then the
// records are in and "send this to your doctor" is an instruction to do
// something we no longer need, which reads as a step they missed.
const SCRIPT_MAX_PHASE = 1;

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
  // Portal-visible, but tier 3 so it stays silent if the retained multi-text
  // model is ever restored — this stage informs, it does not warrant a text.
  [`${BOARDS.INSURANCE}:3`]:  { id: "benefits_sos",      phase: 2, label: "Verifying Your Benefits",       visible: true,  tier: 3, code: "2A" },
  [`${BOARDS.INSURANCE}:4`]:  { id: "submit_auth",       phase: 2, label: "Submitting Authorization",      visible: false, tier: 3, code: "2B" },
  [`${BOARDS.INSURANCE}:6`]:  { id: "auth_outstanding",  phase: 2, label: "Authorization Pending",         visible: true,  tier: 1, code: "2C" },
  [`${BOARDS.INSURANCE}:0`]:  { id: "auth_denied",       phase: 2, label: "Additional Info Requested",     visible: true,  tier: 2, code: "2D", condition: "always_plus_call" },
  [`${BOARDS.INSURANCE}:7`]:  { id: "insurance_complete", phase: 2, label: "Insurance Approved",            visible: true,  tier: 1, code: "2E" },
  [`${BOARDS.INSURANCE}:2`]:  { id: "stuck_insurance",   phase: 2, label: "Under Review",                  visible: false, tier: 3 },

  // Welcome Call board
  [`${BOARDS.WELCOME_CALL}:7`]: { id: "welcome_call",      phase: 3, label: "Scheduling Your Welcome Call",  visible: true,  tier: 3, code: "3A" },
  [`${BOARDS.WELCOME_CALL}:0`]: { id: "review_profile",    phase: 3, label: "Final Profile Confirmation",    visible: false, tier: 3, code: "3B" },
  [`${BOARDS.WELCOME_CALL}:4`]: { id: "completed",         phase: 3, label: "You're All Set!",               visible: true,  tier: 1, code: "3C" },
  [`${BOARDS.WELCOME_CALL}:2`]: { id: "stuck_welcome",     phase: 3, label: "Under Review",                  visible: false, tier: 3 },
};

// Item creation on Medical Eval board = Referral Received (0B)
const REFERRAL_RECEIVED = { id: "referral_received", phase: 0, label: "Referral Received", visible: true, tier: 1, code: "0B" };
const SUBSCRIBER_WELCOME = { id: "subscriber_welcome", phase: 4, label: "Welcome to Your Portal", visible: true, tier: 1, code: "4A" };

// Patient-facing stage copy. Under the single-text model below these are no
// longer SMS bodies — they are the description shown for the current stage on
// the tracking portal, cached into patient state and served by /api/status.
// Every stage needs one, including the ones that never text.
const MESSAGES = {
  referral_received: "We've received your referral and are getting started on your case. We'll keep you updated as we work through the process.",
  send_request: "We're coordinating with your doctor's office to gather the medical documentation needed for your equipment.",
  chase_clinicals: "We're actively following up with your doctor's office to obtain your medical records. This step can sometimes take a few days.",
  medical_complete: "Great news — your medical records have been reviewed and approved. We're now moving to the insurance verification step.",
  benefits_sos: "We're verifying your insurance benefits and confirming what your plan covers. This is the first step before we submit your authorization request.",
  auth_outstanding: "Your prior authorization has been submitted to your insurance company. We're waiting on their decision — this typically takes 5–10 business days.",
  auth_denied: "Your insurance has requested additional information before approving your equipment. Our team is working on next steps and will be in touch.",
  insurance_complete: "Your insurance has approved your equipment. We're almost there!",
  welcome_call: "",
  completed: "You're all set! Your equipment order is queued. Welcome to Medically Modern!",
  // Retained but no longer sent — the 4A welcome SMS is suppressed under the
  // single-text model. Kept so re-enabling it needs no copywriting.
  subscriber_welcome: "Welcome to your Medically Modern patient portal! You can now log in to manage your account, update your information, and track the status of your orders.\n\nBookmark this link for easy access:\nhttps://medically-modern.github.io/mm-subscriber-portal/\n\nIf you have any questions, our team is here to help."
};

// ─── The one text ───
// A patient receives exactly one SMS for the whole intake, sent when their case
// lands on the Medical Evaluation board. Every stage after it updates the portal
// silently, so this message carries the entire relationship: it has to explain
// that the link is the channel, and earn a bookmark. Nothing else reaches them.
const INTAKE_SMS_STAGE = "0B";

// ...and only from the referral sources listed here. Not texting is the default
// and the list is the exception: most referrals reach us through someone the
// patient is already dealing with — their manufacturer, a payer, their doctor's
// office — and those people do the telling. A cold text from a company the
// patient never contacted reads as spam, which is a bad way to spend the one
// message we get.
//
// What earns a source a place here is telling its own patients we are coming, so
// our text lands as the thing they were told to expect. District Endocrine does;
// that is the whole reason it is listed and the generic Doctor label is not.
//
// Referral Source carried ten labels when this was last checked — Patient,
// Tandem, Beta Bionics, CareCentrix, Doctor, Solace Advocates, Wellstart, SNJ,
// District Endocrine, SNJ [2.0] — and the board grows them faster than this
// comment gets updated. Read that as a sample, not an inventory: the array is
// what governs, and a label missing from it is never texted.
const INTAKE_SMS_REFERRAL_SOURCES = ["Patient", "District Endocrine"];

// The doctor's script is offered to a strictly narrower set, which is why this
// is its own list rather than a second read of the one above. A patient who came
// to us directly is chasing their own paperwork and the script is the fastest
// thing we can hand them. A practice referral already has staff driving it, and
// giving that patient a prescription to chase cuts across the people doing the
// work. So District Endocrine is texted and gets no script card — adding a
// source to the text list is not a decision about scripts, and vice versa.
const SCRIPT_REFERRAL_SOURCES = ["Patient"];

// Matches on the label text, not the status index. The index is a label id that
// survives a reorder but not a delete-and-recreate, and the text is what anyone
// looking at the board sees. An unset column returns "" and matches nothing —
// deliberately, since "not on the list" includes "not filled in yet".
function matchesReferralSource(referralSourceText, allowedLabels) {
  const value = String(referralSourceText || "").trim().toLowerCase();
  if (!value) return false;
  return allowedLabels.some((label) => label.trim().toLowerCase() === value);
}

function isTextableReferralSource(referralSourceText) {
  return matchesReferralSource(referralSourceText, INTAKE_SMS_REFERRAL_SOURCES);
}

function isScriptReferralSource(referralSourceText) {
  return matchesReferralSource(referralSourceText, SCRIPT_REFERRAL_SOURCES);
}

// Which wording the intake text uses -- see buildIntakeSms. Not a gate: the list
// above decides whether a source is texted at all.
function isDistrictEndocrineReferral(referralSourceText) {
  return matchesReferralSource(referralSourceText, ["District Endocrine"]);
}

// Intake texts sent by hand. Keyed by Medical Evaluation item id, value is the
// date it was sent. The recovery path re-attempts the intake text on every later
// Medical Eval stage change for any item without a delivery record, and a text
// sent from someone's phone leaves no record -- so without this, a patient who
// was already sent their link by hand gets the full intake message again on
// their next stage move. There is no admin write path into Redis, which is why
// this lives in code. An entry is dead once the patient leaves Medical Eval
// (each board has its own item id, and recovery runs on this board only) and
// can be removed then.
const MANUAL_INTAKE_SENDS = {
  "13021886969": "2026-09-17"
};

function manualIntakeSendDate(itemId) {
  return MANUAL_INTAKE_SENDS[String(itemId)] || null;
}

// The name the District Endocrine text greets them by: the item name without the
// [TEST] marker, up to the first space -- the same first name the tracker says
// hello to. Names on Medical Evaluation are "First Last" (every District
// Endocrine item, checked September 2026), so this is never a surname.
function firstNameOf(patientName) {
  return String(patientName || "").replace(/^\[TEST\]\s*/, "").trim().split(/\s+/)[0];
}

// Returns null when there is no UID to build a link from. That is deliberate —
// this text promises a link, and sending it without one spends the patient's
// only notification on a dead end. Callers must treat null as "don't send".
//
// Two wordings. District Endocrine referrals get the text Medically Modern
// wrote for them in September 2026: from Katie, by first name, naming the
// practice. Every other source on the text list gets the default below. Both
// carry the full tracking link with nothing after it on its line: a phone that
// folds trailing punctuation into the URL sends the patient to a tracker that
// rejects the UID. That is why the District Endocrine text has no full stop
// after its link, although the wording as written had one.
//
// Deliberately ASCII: em-dashes and curly quotes fall outside GSM-7, which
// forces the whole message into UCS-2 at 67 chars per segment instead of 153.
// The rest of MESSAGES above still uses them, but those never go out as SMS
// now — these do, and they are long enough for the encoding to matter. That
// includes apostrophes: "it's" and "We're" must stay straight.
function buildIntakeSms(patientUid, { patientName = "", referralSource = "" } = {}) {
  if (!patientUid) return null;

  if (isDistrictEndocrineReferral(referralSource)) {
    const firstName = firstNameOf(patientName);
    return `Hi${firstName ? ` ${firstName}` : ""}, it's Katie from Medically Modern. We received your prescription for your supplies from District Endocrine. We're working on processing your order.

You can track your order here: ${PORTAL_BASE_URL}?p=${patientUid}

Call or text us if you have any questions!`;
  }

  return `Hi, it's Medically Modern. We've received your referral and we're getting started on your order.

Track your progress anytime:
${PORTAL_BASE_URL}?p=${patientUid}

Save this link - it updates at every step, so you can always see where things stand. We'll contact you directly if we ever need you to confirm anything.

Feel free to text us with any questions!`;
}

// Groups that indicate "Completed" on Welcome Call board
const COMPLETED_GROUPS = {
  [BOARDS.WELCOME_CALL]: "group_mm1x5s5d"
};

module.exports = {
  BOARDS, PORTAL_BASE_URL, STAGE_COLUMNS, PHONE_COLUMN, PHONE_COLUMN_SUBSCRIPTION, NAME_COLUMN, INTAKE_DATE_COLUMN,
  PATIENT_UID_COLUMNS, REFERRAL_SOURCE_COLUMN, SCRIPT_COLUMNS, DEVICE_NOT_SERVED, SCRIPT_MAX_PHASE,
  STAGE_MAP, REFERRAL_RECEIVED, SUBSCRIBER_WELCOME,
  MESSAGES, COMPLETED_GROUPS,
  INTAKE_SMS_STAGE, INTAKE_SMS_REFERRAL_SOURCES, SCRIPT_REFERRAL_SOURCES,
  isTextableReferralSource, isScriptReferralSource, buildIntakeSms,
  MANUAL_INTAKE_SENDS, manualIntakeSendDate
};
