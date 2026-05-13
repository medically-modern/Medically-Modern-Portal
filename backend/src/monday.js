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
    body: JSON.stringify({ query, variables: JSON.stringify(variables) })
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

// Get a single item by ID with relevant columns
async function getItem(itemId) {
  const data = await mondayQuery(`{
    items(ids: [${itemId}]) {
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
    const data = await mondayQuery(`{
      boards(ids: [${boardId}]) {
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
        return { ...item, boardId };
      }
    }
  }
  return null;
}

// Create a new item on a board
async function createItem(boardId, groupId, itemName, columnValues = {}) {
  const data = await mondayQuery(`
    mutation {
      create_item(
        board_id: ${boardId},
        group_id: "${groupId}",
        item_name: "${itemName}",
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
  const data = await mondayQuery(`
    mutation {
      change_column_value(
        board_id: ${boardId},
        item_id: ${itemId},
        column_id: "${columnId}",
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
  const data = await mondayQuery(`
    mutation {
      move_item_to_group(item_id: ${itemId}, group_id: "${groupId}") {
        id
      }
    }
  `);
  return data.move_item_to_group;
}

module.exports = { mondayQuery, getItem, findPatientByPhone, createItem, updateColumn, changeStage, moveItemToGroup };
