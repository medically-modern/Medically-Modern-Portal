// ─── [#5] Input validation helpers ───
function validateNumericId(id, label = "ID") {
  const str = String(id);
  if (!/^\d+$/.test(str)) {
    throw new Error(`Invalid ${label}: must be numeric, got "${str}"`);
  }
  return str;
}

function validateColumnId(id) {
  const str = String(id);
  if (!/^[a-z0-9_]+$/.test(str)) {
    throw new Error(`Invalid column ID: must be alphanumeric/underscore, got "${str}"`);
  }
  return str;
}

function validateGroupId(id) {
  const str = String(id);
  if (!/^[a-z0-9_]+$/.test(str)) {
    throw new Error(`Invalid group ID: must be alphanumeric/underscore, got "${str}"`);
  }
  return str;
}

const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
const API_URL = "https://api.monday.com/v2";

async function mondayQuery(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": MONDAY_TOKEN,
      "API-Version": "2024-10"
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

// Get a single item by ID with relevant columns
async function getItem(itemId) {
  const safeId = validateNumericId(itemId, "item ID");
  const data = await mondayQuery(`{
    items(ids: [${safeId}]) {
      id name board { id } group { id title }
      column_values { id type text value }
    }
  }`);
  return data.items?.[0] || null;
}

// Find patient by phone number across pipeline boards
async function findPatientByPhone(phone, boardIds) {
  // Normalize phone: strip everything except digits
  const digits = phone.replace(/\D/g, "");

  for (const boardId of boardIds) {
    const safeBoard = validateNumericId(boardId, "board ID");
    const data = await mondayQuery(`{
      boards(ids: [${safeBoard}]) {
        items_page(limit: 500) {
          items {
            id name group { id title }
            column_values(ids: ["phone_mm1x44yk", "color_mm1wyr92", "color_mm1ws96t", "date_mm1wf43j"]) {
              id type text value
            }
          }
        }
      }
    }`);

    const board = data.boards?.[0];
    if (!board) continue;

    for (const item of board.items_page.items) {
      const phoneCol = item.column_values.find(c => c.id === "phone_mm1x44yk");
      if (phoneCol?.text && phoneCol.text.replace(/\D/g, "").includes(digits)) {
        return { ...item, boardId: safeBoard };
      }
    }
  }
  return null;
}

// Create a new item on a board
async function createItem(boardId, groupId, itemName, columnValues = {}) {
  const safeBoard = validateNumericId(boardId, "board ID");
  const safeGroup = validateGroupId(groupId);
  // Sanitize item name — strip quotes to prevent injection
  const safeName = String(itemName).replace(/"/g, '\\"');
  const data = await mondayQuery(`
    mutation {
      create_item(
        board_id: ${safeBoard},
        group_id: "${safeGroup}",
        item_name: "${safeName}",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id name
      }
    }
  `);
  return data.create_item;
}

// Update a column value on an item
async function updateColumn(boardId, itemId, columnId, value) {
  const safeBoard = validateNumericId(boardId, "board ID");
  const safeItem = validateNumericId(itemId, "item ID");
  const safeCol = validateColumnId(columnId);
  const data = await mondayQuery(`
    mutation {
      change_column_value(
        board_id: ${safeBoard},
        item_id: ${safeItem},
        column_id: "${safeCol}",
        value: ${JSON.stringify(JSON.stringify(value))}
      ) {
        id
      }
    }
  `);
  return data.change_column_value;
}

// Change item's status column (stage advancer)
async function changeStage(boardId, itemId, columnId, labelIndex) {
  return updateColumn(boardId, itemId, columnId, { index: labelIndex });
}

// Move item to a group
async function moveItemToGroup(boardId, itemId, groupId) {
  const safeItem = validateNumericId(itemId, "item ID");
  const safeGroup = validateGroupId(groupId);
  const data = await mondayQuery(`
    mutation {
      move_item_to_group(item_id: ${safeItem}, group_id: "${safeGroup}") {
        id
      }
    }
  `);
  return data.move_item_to_group;
}

// Find patient by UID across pipeline boards
async function findPatientByUid(uid) {
  const { BOARDS, PATIENT_UID_COLUMNS } = require("./config");
  const boardIds = [BOARDS.WELCOME_CALL, BOARDS.INSURANCE, BOARDS.MEDICAL_EVAL, BOARDS.SUBSCRIPTION];

  for (const boardId of boardIds) {
    const uidColumnId = PATIENT_UID_COLUMNS[boardId];
    if (!uidColumnId) continue;

    const safeBoard = validateNumericId(boardId, "board ID");
    const safeUidCol = validateColumnId(uidColumnId);

    const data = await mondayQuery(`{
      boards(ids: [${safeBoard}]) {
        items_page(limit: 500) {
          items {
            id name group { id title }
            column_values(ids: ["${safeUidCol}", "phone_mm1x44yk", "color_mm1wyr92", "color_mm1ws96t", "date_mm1wf43j"]) {
              id type text value
            }
          }
        }
      }
    }`);

    const board = data.boards?.[0];
    if (!board) continue;

    for (const item of board.items_page.items) {
      const uidCol = item.column_values.find(c => c.id === uidColumnId);
      if (uidCol?.text === uid) {
        return { ...item, boardId: safeBoard };
      }
    }
  }
  return null;
}

module.exports = { mondayQuery, getItem, findPatientByPhone, findPatientByUid, createItem, updateColumn, changeStage, moveItemToGroup };
