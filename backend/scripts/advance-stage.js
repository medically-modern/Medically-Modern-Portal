// Advances a test patient through pipeline stages
// Usage: MONDAY_TOKEN=xxx node scripts/advance-stage.js <item_id> <target_stage>
//
// Stages: evaluate_mn, send_request, confirm_receipt, chase_clinicals, medical_complete,
//         benefits, submit_auth, auth_outstanding, auth_denied, insurance_complete,
//         welcome_call, completed

const MONDAY_TOKEN = process.env.MONDAY_TOKEN;

const BOARDS = {
  MEDICAL_EVAL: "18406060017",
  INSURANCE: "18410601299",
  WELCOME_CALL: "18410804557"
};

// Stage transitions define what to do at each step
const TRANSITIONS = {
  // Medical Eval stages
  evaluate_mn:     { board: BOARDS.MEDICAL_EVAL, column: "color_mm1wyr92", index: 8 },
  send_request:    { board: BOARDS.MEDICAL_EVAL, column: "color_mm1wyr92", index: 9 },
  confirm_receipt: { board: BOARDS.MEDICAL_EVAL, column: "color_mm1wyr92", index: 10 },
  chase_clinicals: { board: BOARDS.MEDICAL_EVAL, column: "color_mm1wyr92", index: 11 },
  medical_complete:{ board: BOARDS.MEDICAL_EVAL, column: "color_mm1wyr92", index: 14 },

  // Insurance stages (item must be on Insurance board)
  benefits:        { board: BOARDS.INSURANCE, column: "color_mm1ws96t", index: 3 },
  submit_auth:     { board: BOARDS.INSURANCE, column: "color_mm1ws96t", index: 4 },
  auth_outstanding:{ board: BOARDS.INSURANCE, column: "color_mm1ws96t", index: 6 },
  auth_denied:     { board: BOARDS.INSURANCE, column: "color_mm1ws96t", index: 0 },
  insurance_complete:{ board: BOARDS.INSURANCE, column: "color_mm1ws96t", index: 7 },

  // Welcome Call stages (item must be on Welcome Call board)
  welcome_call:    { board: BOARDS.WELCOME_CALL, column: "color_mm1ws96t", index: 7 },
  completed:       { board: BOARDS.WELCOME_CALL, column: "color_mm1ws96t", index: 4 },
};

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
  const [itemId, targetStage] = process.argv.slice(2);

  if (!itemId || !targetStage) {
    console.log("Usage: node advance-stage.js <item_id> <target_stage>");
    console.log("\nAvailable stages:");
    Object.keys(TRANSITIONS).forEach(s => console.log(`  ${s}`));
    process.exit(1);
  }

  const transition = TRANSITIONS[targetStage];
  if (!transition) {
    console.error(`Unknown stage: ${targetStage}`);
    process.exit(1);
  }

  console.log(`Advancing item ${itemId} to stage: ${targetStage}`);
  console.log(`  Board: ${transition.board}, Column: ${transition.column}, Index: ${transition.index}`);

  const columnValue = JSON.stringify({ index: transition.index });

  const result = await mondayQuery(`
    mutation {
      change_column_value(
        board_id: ${transition.board},
        item_id: ${itemId},
        column_id: "${transition.column}",
        value: ${JSON.stringify(columnValue)}
      ) {
        id name
      }
    }
  `);

  if (result.errors) {
    console.error("ERROR:", result.errors);
  } else {
    console.log(`  ✓ ${result.data.change_column_value.name} → ${targetStage}`);
  }
}

main().catch(console.error);
