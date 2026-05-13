// SMS dispatch with safety checks
// Blocks any sends to 555 numbers or test patterns

function isTestPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  // Block 555 numbers (reserved for testing)
  if (digits.includes("555")) return true;
  // Block obviously fake numbers
  if (digits.startsWith("0000") || digits.startsWith("1111")) return true;
  return false;
}

function isTestPatient(name) {
  return name.startsWith("[TEST]") || name.toLowerCase().startsWith("test ");
}

async function sendSMS(phone, message, { patientName = "", dryRun = true } = {}) {
  // Safety: never send to test numbers
  if (isTestPhone(phone)) {
    console.log(`[sms] BLOCKED (test phone ${phone}): "${message.substring(0, 60)}..."`);
    return { sent: false, reason: "test_phone" };
  }

  // Safety: never send to test patients
  if (isTestPatient(patientName)) {
    console.log(`[sms] BLOCKED (test patient ${patientName}): "${message.substring(0, 60)}..."`);
    return { sent: false, reason: "test_patient" };
  }

  // Safety: dry run mode (default until RingCentral is wired up)
  if (dryRun) {
    console.log(`[sms] DRY RUN → ${phone}: "${message.substring(0, 60)}..."`);
    return { sent: false, reason: "dry_run" };
  }

  // TODO: actual RingCentral send
  // const rc = require('./ringcentral');
  // return rc.sendSMS(phone, message);
  
  console.log(`[sms] SENT → ${phone}: "${message.substring(0, 60)}..."`);
  return { sent: true };
}

module.exports = { sendSMS, isTestPhone, isTestPatient };
