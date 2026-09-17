// ─── The doctor's script ───
// The prescription template a patient can hand to their own doctor, offered as
// a download on the tracker.
//
// It used to be emailed and texted from the intake backend the moment the form
// was submitted. It is generated here instead because the intake form and the
// tracker are different monday items on different boards -- the form writes to
// Profile Send Off, the patient is re-created on Medical Evaluation about half
// an hour later, and nothing carries a file across.
//
// The physician block is left blank even though this board carries a doctor name
// and NPI for nearly every patient. This document is handed to whoever actually
// writes the prescription, and that is not always the doctor on our record --
// printing a name and NPI the prescriber did not put there makes the page look
// signed-off when nobody has signed it. pdf.js rules a line instead.
//
// Nothing here reaches monday or the filesystem beyond the cached templates, so
// it is safe to call on any request path.

const {
  REFERRAL_SOURCE_COLUMN, SCRIPT_COLUMNS, DEVICE_NOT_SERVED, SCRIPT_MAX_PHASE,
  isScriptReferralSource
} = require("./config");
const { fillCgmPdf, fillPumpPdf } = require("./pdf");

// What each kind is called on the page and in the saved file. `label` is the
// button; the device model goes next to it so a patient with two scripts can
// tell them apart at a glance.
const KINDS = {
  cgm:  { label: "CGM script",  noun: "CGM Prescription",  column: "cgmType",  fill: fillCgmPdf },
  pump: { label: "Pump script", noun: "Pump Prescription", column: "pumpType", fill: fillPumpPdf }
};

function columnText(item, columnId) {
  return item?.column_values?.find(c => c.id === columnId)?.text || "";
}

// Everything the templates need, read off one Medical Evaluation item.
function readScriptFields(item) {
  return {
    patientName: (item?.name || "").replace(/^\[TEST\]\s*/, "").trim(),
    dob:         columnText(item, SCRIPT_COLUMNS.dob),
    cgmType:     columnText(item, SCRIPT_COLUMNS.cgmType),
    pumpType:    columnText(item, SCRIPT_COLUMNS.pumpType),
    referralSource: columnText(item, REFERRAL_SOURCE_COLUMN)
  };
}

function isServed(device) {
  const d = String(device || "").trim();
  return d !== "" && d.toLowerCase() !== DEVICE_NOT_SERVED.toLowerCase();
}

// Which templates this patient gets. Driven by the device columns rather than
// Request Type: a "Supplies Only" patient still has a pump on record and still
// needs the pump document, which is the one a supplier asks for.
function scriptKindsFor(fields) {
  return Object.keys(KINDS).filter(kind => isServed(fields[KINDS[kind].column]));
}

// Whether to offer the script at all. This reads SCRIPT_REFERRAL_SOURCES, which
// is deliberately narrower than the list that governs the intake text: a
// manufacturer or practice referral already has someone driving the paperwork,
// and handing that patient a prescription to chase would cut across them. The
// two were one predicate until District Endocrine joined the text list -- if you
// are adding a referral source, decide the two questions separately.
function scriptsAreOffered({ referralSource, phase }) {
  return isScriptReferralSource(referralSource) && Number(phase) <= SCRIPT_MAX_PHASE;
}

// Matches the name the intake backend used, so a patient who was emailed one
// before this change recognises the file.
function scriptFilename(kind, patientName) {
  const safeName = String(patientName || "").replace(/[^a-zA-Z0-9 ]/g, "").replace(/ /g, "_") || "Patient";
  return `Medically_Modern_${KINDS[kind].noun.replace(/ /g, "_")}_${safeName}.pdf`;
}

// What the tracker renders. An empty array means no card at all. Deliberately
// just the kind and its button text: "CGM script" and "Pump script" already tell
// two downloads apart, and naming the device model here would mean caching it.
function scriptsPayload(kinds) {
  return kinds.filter(kind => KINDS[kind]).map(kind => ({ kind, label: KINDS[kind].label }));
}

async function buildScriptPdf(kind, fields) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`unknown script kind: ${kind}`);
  return spec.fill({
    patientName: fields.patientName,
    dob: fields.dob,
    cgmType: fields.cgmType,
    pumpType: fields.pumpType,
    // Blank on purpose -- the prescriber fills and signs these. See the header.
    doctorName: "",
    doctorNpi: ""
  });
}

module.exports = {
  KINDS, readScriptFields, scriptKindsFor, scriptsAreOffered,
  scriptFilename, scriptsPayload, buildScriptPdf
};
