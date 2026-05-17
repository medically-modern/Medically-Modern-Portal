# Monday.com Webhook Configuration

> Last updated: 2026-05-17

## Webhook URL

All portal webhooks point to:
```
https://patient-portal-backend-production.up.railway.app/webhooks/monday
```

## Authentication

Monday.com sends the API token (same value as `MONDAY_TOKEN` env var) in the `Authorization` header of every webhook request. The backend verifies this header matches `MONDAY_TOKEN` — no separate signing secret is needed.

## Portal Webhooks (used by the backend)

| Board | Board ID | Webhook ID | Event | Purpose |
|---|---|---|---|---|
| Medical Evaluation | 18406060017 | 580027645 | `create_item` | Triggers 0B (Referral Received) + UID assignment |
| Medical Evaluation | 18406060017 | 580027653 | `change_column_value` | Stage changes (1A–1E) |
| Insurance | 18410601299 | 580027830 | `change_column_value` | Stage changes (2A–2E) |
| Welcome Call | 18410804557 | 580027846 | `create_item` | Detects new items on Welcome Call board |
| Welcome Call | 18410804557 | 580027855 | `change_column_value` | Stage changes (3A–3B) |
| Welcome Call | 18410804557 | 581300418 | `item_moved_to_any_group` | Triggers 3C (You're All Set!) when moved to Completed group |

## Other Webhooks (not used by the portal backend)

Each board also has `change_specific_column_value` webhooks for various columns (text, phone, email, dropdown, location, color). These appear to be from Monday automations or other integrations — the portal backend ignores them since they don't match the stage advancer column.

Many of these are duplicated (same column ID, two webhook IDs). This is likely from duplicate Monday automation setups and could be cleaned up.

## Bug Fix: Missing move_item_to_group Webhook

The `item_moved_to_any_group` webhook (ID 581300418) was **added on 2026-05-17** because it was missing. Without it, moving a Welcome Call item to the "Completed" group (group_mm1x5s5d) did NOT trigger the 3C "You're All Set!" notification. This webhook must stay active for the final stage to work.

## Recreating Webhooks

If you need to recreate the portal webhooks (e.g., after changing the Railway URL):

```bash
MONDAY_TOKEN="your_token"
URL="https://your-new-url/webhooks/monday"

# Medical Evaluation
curl -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18406060017, url: \"'$URL'\", event: create_item) { id } }"}'

curl -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18406060017, url: \"'$URL'\", event: change_column_value) { id } }"}'

# Insurance
curl -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410601299, url: \"'$URL'\", event: change_column_value) { id } }"}'

# Welcome Call
curl -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410804557, url: \"'$URL'\", event: create_item) { id } }"}'

curl -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410804557, url: \"'$URL'\", event: change_column_value) { id } }"}'

curl -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410804557, url: \"'$URL'\", event: item_moved_to_any_group) { id } }"}'
```
