// Creates test patients on the Medical Evaluation board
// SAFETY: All test patients use 555 numbers and [TEST] prefix names
// The SMS module blocks sends to 555 numbers and [TEST]-prefixed names
//
// Usage: MONDAY_TOKEN=xxx node scripts/create-test-patient.js

const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
const MEDICAL_EVAL_BOARD = "18406060017";
const MEDICAL_NECESSITY_GROUP = "group_mm1xf2jb";

async function mondayQuery(query) {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": MONDAY_TOKEN,
      "API-Version": "2024-10"
    },
    body: JSON.stringify({ query })
  });
  return res.json();
}

async function main() {
  const testPatients = [
    { name: "[TEST] Portal Alpha", phone: "+15550100001" },
    { name: "[TEST] Portal Beta",  phone: "+15550100002" },
    { name: "[TEST] Portal Gamma", phone: "+15550100003" },
  ];

  for (const patient of testPatients) {
    console.log(`Creating: ${patient.name}...`);

    const columnValues = JSON.stringify({
      phone_mm1x44yk: { phone: patient.phone, countryShortName: "US" },
      text_mm1xvxst: "1990-01-01",
      text_mm1xc140: "test@test.invalid",
      date_mm1wf43j: { date: new Date().toISOString().split("T")[0] }
    });

    const result = await mondayQuery(`
      mutation {
        create_item(
          board_id: ${MEDICAL_EVAL_BOARD},
          group_id: "${MEDICAL_NECESSITY_GROUP}",
          item_name: "${patient.name}",
          column_values: ${JSON.stringify(columnValues)}
        ) { id name }
      }
    `);

    if (result.errors) console.error(`  ERROR:`, result.errors);
    else console.log(`  Created: ID ${result.data.create_item.id}`);
  }
  console.log("\nDone! Test patients use 555 numbers — SMS will be blocked by sms.js safety checks.");
}

main().catch(console.error);
