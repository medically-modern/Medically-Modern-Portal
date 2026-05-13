// Creates a test patient on the Medical Evaluation board
// Usage: MONDAY_TOKEN=xxx node scripts/create-test-patient.js

const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
const MEDICAL_EVAL_BOARD = "18406060017";
const MEDICAL_NECESSITY_GROUP = "group_mm1xf2jb"; // "2. Medical Necessity" group

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
    {
      name: "Test Patient Alpha",
      phone: "+15551000001",
      dob: "1990-01-15",
      email: "test.alpha@example.com",
      stage: 8  // Evaluate MN
    },
    {
      name: "Test Patient Beta",
      phone: "+15551000002",
      dob: "1985-06-22",
      email: "test.beta@example.com",
      stage: 9  // Send Request
    },
    {
      name: "Test Patient Gamma",
      phone: "+15551000003",
      dob: "1978-11-30",
      email: "test.gamma@example.com",
      stage: 11  // Chase Clinicals
    }
  ];

  for (const patient of testPatients) {
    console.log(`Creating: ${patient.name}...`);

    const columnValues = JSON.stringify({
      phone_mm1x44yk: { phone: patient.phone, countryShortName: "US" },
      text_mm1xvxst: patient.dob,
      text_mm1xc140: patient.email,
      date_mm1wf43j: { date: new Date().toISOString().split("T")[0] },
      color_mm1wyr92: { index: patient.stage }
    });

    const result = await mondayQuery(`
      mutation {
        create_item(
          board_id: ${MEDICAL_EVAL_BOARD},
          group_id: "${MEDICAL_NECESSITY_GROUP}",
          item_name: "${patient.name}",
          column_values: ${JSON.stringify(columnValues)}
        ) {
          id name
        }
      }
    `);

    if (result.errors) {
      console.error(`  ERROR:`, result.errors);
    } else {
      console.log(`  Created: ID ${result.data.create_item.id}`);
    }
  }

  console.log("\nDone! Test patients created on Medical Evaluation board.");
}

main().catch(console.error);
