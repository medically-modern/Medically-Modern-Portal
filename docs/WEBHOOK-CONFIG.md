# Monday.com Webhook Configuration

> Last updated: 2026-05-17

## Webhook URL

All portal webhooks point to a secret URL:
```
https://patient-portal-backend-production.up.railway.app/webhooks/monday/{MONDAY_WEBHOOK_SECRET}
```

The `MONDAY_WEBHOOK_SECRET` is a 64-character hex string stored as an environment variable on Railway. It is embedded in the URL path and verified server-side with `crypto.timingSafeEqual`. An attacker cannot send crafted payloads without knowing the full URL.

## Authentication

The webhook URL itself is the secret. Monday.com stores the full URL (including the secret segment) when the webhook is created. The backend verifies the `:secret` path parameter matches the `MONDAY_WEBHOOK_SECRET` env var before processing any payload — including challenge responses.

## Active Webhooks

| Board | Board ID | Webhook ID | Event | Config | Purpose |
|---|---|---|---|---|---|
| Medical Evaluation | 18406060017 | 581302884 | `create_item` | — | Triggers 0B (Referral Received) + UID assignment |
| Medical Evaluation | 18406060017 | 581302887 | `change_specific_column_value` | `color_mm1wyr92` | Stage advancer changes (1A–1E) |
| Insurance | 18410601299 | 581302889 | `change_specific_column_value` | `color_mm1ws96t` | Stage advancer changes (2A–2E) |
| Welcome Call | 18410804557 | 581302890 | `create_item` | — | Detects new items on Welcome Call board |
| Welcome Call | 18410804557 | 581302892 | `change_specific_column_value` | `color_mm1ws96t` | Stage advancer changes (3A–3B) |

### Stage Advancer Columns

- **Medical Evaluation**: `color_mm1wyr92`
- **Insurance**: `color_mm1ws96t`
- **Welcome Call**: `color_mm1ws96t`

These are the ONLY columns that trigger webhooks. All other column changes are ignored.

## Design Decisions

1. **`change_specific_column_value` instead of `change_column_value`**: The broad `change_column_value` event fires on ANY column change (text, phone, email, dropdown, etc.), causing unnecessary webhook traffic. Using `change_specific_column_value` with the stage advancer column ID means we only fire when the stage actually changes.

2. **No `item_moved_to_any_group` webhook**: The "You're All Set!" (3C) notification was intentionally removed from the pipeline. Moving a Welcome Call item to the Completed group does NOT trigger any notification.

3. **URL-based secret**: Monday.com doesn't support HMAC webhook signing. Instead of relying on the Authorization header (which just echoes back the API token), we embed an unguessable 64-char hex secret in the URL path.

## Recreating Webhooks

If you need to recreate the portal webhooks (e.g., after changing the Railway URL or rotating the secret):

```bash
MONDAY_TOKEN="your_monday_api_token"
SECRET="your_64_char_hex_secret"
URL="https://your-railway-url/webhooks/monday/$SECRET"

# Medical Evaluation — create_item
curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18406060017, url: \"'"$URL"'\", event: create_item) { id } }"}'

# Medical Evaluation — stage advancer (color_mm1wyr92)
curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18406060017, url: \"'"$URL"'\", event: change_specific_column_value, config: \"{\\\"columnId\\\":\\\"color_mm1wyr92\\\"}\") { id } }"}'

# Insurance — stage advancer (color_mm1ws96t)
curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410601299, url: \"'"$URL"'\", event: change_specific_column_value, config: \"{\\\"columnId\\\":\\\"color_mm1ws96t\\\"}\") { id } }"}'

# Welcome Call — create_item
curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410804557, url: \"'"$URL"'\", event: create_item) { id } }"}'

# Welcome Call — stage advancer (color_mm1ws96t)
curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410804557, url: \"'"$URL"'\", event: change_specific_column_value, config: \"{\\\"columnId\\\":\\\"color_mm1ws96t\\\"}\") { id } }"}'
```

**Important**: The new code must be deployed and the `MONDAY_WEBHOOK_SECRET` env var must be set on Railway BEFORE creating webhooks. Monday sends a challenge request to verify the URL is live.

## Deleting Webhooks

```bash
MONDAY_TOKEN="your_monday_api_token"
WEBHOOK_ID="the_webhook_id"

curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { delete_webhook(id: '"$WEBHOOK_ID"') { id } }"}'
```

## Listing Webhooks

```bash
MONDAY_TOKEN="your_monday_api_token"
BOARD_ID="the_board_id"

curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "{ webhooks(board_id: '"$BOARD_ID"') { id event config } }"}'
```
