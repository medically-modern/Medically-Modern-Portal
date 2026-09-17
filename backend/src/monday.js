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

// Portal UIDs are v4 UUIDs, and findPatientByUid interpolates one into a query.
// Same posture as the validators above: reject anything else before it gets
// near a query string.
function validateUid(uid) {
  const str = String(uid);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    throw new Error(`Invalid patient UID: must be a UUID, got "${str}"`);
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

// The patient's item for a portal UID. Two paths, cheapest first.
//
// The uid index in Redis outlives the cached state -- 90 days against 30 -- so
// on most cache misses the item id is still known. Callers pass it as a hint:
// one fetch by id, with the UID column checked before it is trusted, since an
// index can point at an item that was since deleted or re-created. Failing
// that, each board is asked for the item whose UID column equals this value,
// which is an indexed lookup on monday's side at ~50 to ~200 complexity.
//
// It used to page through the first 500 items of each board and compare in
// code: 7,020 complexity per board, and blind past 500. Medical Evaluation
// passed 500 items in September 2026 and Subscription passed 800, so a patient
// outside the first page was "not found" the moment their cached state expired.
//
// Board order is unchanged, most advanced first: the same UID is on every board
// the patient has reached, and the furthest one is their current status. Every
// column comes back either way, so callers need no second fetch.
async function findPatientByUid(uid, { itemIdHint } = {}) {
  const { BOARDS, PATIENT_UID_COLUMNS } = require("./config");
  const safeUid = validateUid(uid);

  // The hint is only ever an item id written by indexUid, but it is the one
  // input here not validated upstream, so a corrupt value is skipped, not
  // thrown on.
  if (itemIdHint && /^\d+$/.test(String(itemIdHint))) {
    const item = await getItem(itemIdHint);
    const boardId = String(item?.board?.id || "");
    const uidColumnId = PATIENT_UID_COLUMNS[boardId];
    const matches = Boolean(uidColumnId) &&
      item.column_values.some(c => c.id === uidColumnId && c.text === safeUid);
    if (matches) return { ...item, boardId };
    console.log(`[monday] uid index pointed ${safeUid} at item ${itemIdHint}, which is ${item ? "a different patient" : "gone"}; searching boards`);
  }

  const boardIds = [BOARDS.WELCOME_CALL, BOARDS.INSURANCE, BOARDS.MEDICAL_EVAL, BOARDS.SUBSCRIPTION];
  for (const boardId of boardIds) {
    const uidColumnId = PATIENT_UID_COLUMNS[boardId];
    if (!uidColumnId) continue;

    const safeBoard = validateNumericId(boardId, "board ID");
    const safeUidCol = validateColumnId(uidColumnId);

    const data = await mondayQuery(`{
      items_page_by_column_values(board_id: ${safeBoard}, limit: 1, columns: [{ column_id: "${safeUidCol}", column_values: ["${safeUid}"] }]) {
        items {
          id name board { id } group { id title }
          column_values { id type text value }
        }
      }
    }`);

    const item = data.items_page_by_column_values?.items?.[0];
    if (item) return { ...item, boardId: safeBoard };
  }
  return null;
}

module.exports = { mondayQuery, getItem, findPatientByPhone, findPatientByUid, createItem, updateColumn, changeStage, moveItemToGroup };
