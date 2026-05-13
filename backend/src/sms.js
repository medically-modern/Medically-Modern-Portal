// SMS dispatch with safety checks
// ONLY [TEST] patients receive texts during development
// All real patients are blocked until production flag is flipped

const PRODUCTION_SMS_ENABLED = process.env.PRODUCTION_SMS_ENABLED === "true";

function isTestPatient(name) {
  return name.startsWith("[TEST]") || name.toLowerCase().startsWith("test ");
}

async function sendSMS(phone, message, { patientName = "" } = {}) {
  const testPatient = isTestPatient(patientName);

  // Real patients: blocked unless PRODUCTION_SMS_ENABLED=true
  if (!testPatient && !PRODUCTION_SMS_ENABLED) {
    console.log(`[sms] BLOCKED (real patient "${patientName}"): production SMS not enabled`);
    return { sent: false, reason: "production_sms_disabled" };
  }

  // Test patients: always allowed (log only for now, RingCentral not wired up yet)
  if (testPatient) {
    console.log(`[sms] TEST SEND → ${phone} (${patientName}): "${message.substring(0, 80)}..."`);
    // TODO: wire up RingCentral here when ready
    return { sent: false, reason: "ringcentral_not_configured", wouldSend: true };
  }

  // Production mode with real patient
  console.log(`[sms] PRODUCTION SEND → ${phone}: "${message.substring(0, 80)}..."`);
  // TODO: actual RingCentral send
  return { sent: false, reason: "ringcentral_not_configured", wouldSend: true };
}

module.exports = { sendSMS, isTestPatient, PRODUCTION_SMS_ENABLED };
