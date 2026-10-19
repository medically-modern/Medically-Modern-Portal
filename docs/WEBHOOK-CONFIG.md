# Monday.com Webhook Configuration

> Last updated: 2026-10-19

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
| Insurance | 18410601299 | 581303108 | `create_item` | — | Detects new items created by Med Eval → Insurance automation |
| Insurance | 18410601299 | 581302889 | `change_specific_column_value` | `color_mm1ws96t` | Stage advancer changes (2A–2E) |
| Welcome Call | 18410804557 | 581302890 | `create_item` | — | Detects new items on Welcome Call board |
| Welcome Call | 18410804557 | 581302892 | `change_specific_column_value` | `color_mm1ws96t` | Stage advancer changes (3A–3B) |

### Welcome Call texts (built 2026-10-19, not yet switched on)

Two more webhooks on the Welcome Call board replace the ten Monday automations that texted patients through the RingCentral integration. **The service creates them itself** when it starts with `WELCOME_TEXTS` set to `test` or `on`, skipping any that already exist, and logs `[welcome-text] webhook for <column>: created (<id>)` or `already there (<id>)`. It creates them because the URL carries `MONDAY_WEBHOOK_SECRET`, which only it holds. Monday lists a webhook's column but not its URL, so "already there" means any column-change webhook on that column; nothing else watched either column on 2026-10-19.

| Board | Board ID | Event | Config | Purpose |
|---|---|---|---|---|
| Welcome Call | 18410804557 | `change_specific_column_value` | `color_mm1xzh1x` (Autotext Type) | The "approved and ready for shipment" text, one per label |
| Welcome Call | 18410804557 | `change_specific_column_value` | `color_mm1xtqvv` (Welcome Call Text) | The "SAVE OUR NUMBER / TO CONFIRM" text the Command Center's button sends |

`backend/src/welcomeTexts.js` holds the ten messages, copied word for word from the automations, and sends each from +13475037148 (Corey Deutsch) to Primary Phone, as they did. `backend/test/fixtures/monday-welcome-sms-automations.json` is the automations as Monday exported them; the test fails if a message drifts from it.

`WELCOME_TEXTS` on Railway decides what happens (`/health` shows it as `welcomeTexts`):

- unset, or anything else: **off**. Events are logged and ignored.
- `test`: only patients named `[TEST] …` or `TEST …` are texted.
- `on`: every patient (still subject to `PRODUCTION_SMS_ENABLED`, like every text this service sends).

The automations it replaces (deactivate, don't delete, so rollback is a toggle):

| Automation | Trigger |
|---|---|
| 573200740 | Autotext Type → Beta Bionics |
| 573214800 | Autotext Type → General Diabetes (described "OFF/aug26"; its setter 7918358818 is off, but this one was on) |
| 573208150 | Autotext Type → Tandem |
| 603170115 | Autotext Type → Other - Pump |
| 573213734 | Autotext Type → Tandem Supplies Only |
| 603171287 | Autotext Type → Other - CGM |
| 603172480 | Autotext Type → Other - Pump & CGM |
| 603173668 | Autotext Type → Other - Supplies |
| 603174271 | Autotext Type → Other - Supplies & CGM |
| 7918318033 | Welcome Call Text → Send |

**Cut-over** (off-hours, like any structural board change):

1. Set `WELCOME_TEXTS=test` and let Railway redeploy. Check `/health` says `"welcomeTexts": "test"`.
2. The service creates the two webhooks as it starts (the curl commands below do the same by hand). Real patients are still texted by the automations, and only by them.
3. On a `TEST …` item whose Primary Phone is a team member's own mobile (a 555-01xx number can't receive a text), set Autotext Type, then press Send Welcome Call Text in the Command Center. Each text should arrive twice (once from the automation, once from here), word for word the same, both from (347) 503-7148. The logs show `[welcome-text] … sent (<label>)`. A RingCentral error naming the from number means this service's RingCentral login can't send from Corey's line: stop here.
4. Deactivate the ten automations above, then set `WELCOME_TEXTS=on`. Between the two steps (the redeploy, about a minute), a change to either column texts no one; do it when no one is on the Welcome Call board.

**Rollback**: set `WELCOME_TEXTS` to `off` and reactivate the ten automations. The webhooks can stay; with the texts off, their events are logged and ignored. To remove them, delete them (below) only while `WELCOME_TEXTS` is `off`, or the next start creates them again.

What changes for the patient: nothing in the wording. Trailing spaces and line breaks at the very end of a message are trimmed. A text that RingCentral answers with a 5xx is looked up in its message store before it counts as failed (it often went out anyway); one that really failed is answered 500, so Monday redelivers it, once a minute for up to 30 minutes. Each change on the board is sent at most once, keyed on Monday's `triggerUuid` in Redis (`welcome_text:<uuid>`, 90 days, no patient data).

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

# Insurance — create_item
curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410601299, url: \"'"$URL"'\", event: create_item) { id } }"}'

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

# Welcome Call — Autotext Type (color_mm1xzh1x)
curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410804557, url: \"'"$URL"'\", event: change_specific_column_value, config: \"{\\\"columnId\\\":\\\"color_mm1xzh1x\\\"}\") { id } }"}'

# Welcome Call — Welcome Call Text (color_mm1xtqvv)
curl -s -X POST https://api.monday.com/v2 \
  -H "Authorization: $MONDAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query": "mutation { create_webhook(board_id: 18410804557, url: \"'"$URL"'\", event: change_specific_column_value, config: \"{\\\"columnId\\\":\\\"color_mm1xtqvv\\\"}\") { id } }"}'
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
