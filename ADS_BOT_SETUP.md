# Server-managed advertising on the existing Render service

Status: code prepared; disabled unless explicitly configured. This is a single-tenant, single-instance controller for CPC campaigns using Ozon TARGET_BIDS and an existing native weekly budget. It never migrates the native campaign strategy or creates campaigns. Adaptive, autopilot, funnel and conversion modes are deterministic policies, not an LLM. Control does not use a target DRR. Bid increases require enough observed orders and a non-deteriorating comparison with the previous seven-day baseline; missing baseline data never enables growth.

## Required infrastructure

Use the existing ozon-ai-assistant-api service with paid always-on compute and a persistent disk. Do not deploy the controller against an ephemeral directory. Keep one instance only. The persistent store uses an exclusive lock; an unclean shutdown leaves it locked for operator review rather than permitting duplicate workers or silently replaying an unknown action.

Attach a persistent disk at `/var/data`. Set the following non-secret environment values only after the disk is attached and always-on compute is active:

```
ADS_CONTROL_DIR=/var/data/ozon-ads
ADS_CONTROL_PERSISTENT=true
ADS_CONTROL_ENABLED=true
```

Retain existing APP_ACCESS_TOKEN and Ozon Performance credentials. Do not expose credentials in frontend source. The controller reuses the existing server-side token. A Render plan or disk change is a separate paid operation requiring approval; this file does not authorize a purchase.

## Activation per campaign

Open Advertising → Assistant → Server control. Read compatibility and reason. Select policy, min/max CPC, intensity, weekly cap, daily stop threshold, Moscow weekday hours. Save server settings while the bot is off. Verify the saved settings and confirm application to Ozon before enabling. Enabling pauses the campaign, applies and rereads the native weekly cap, clamps and rereads product bids. Activation occurs only on a later verified worker cycle inside schedule and below spend thresholds.

The Ozon bid update method may overwrite phrases/stop words according to the official documentation. The UI discloses this before confirmation. No product is added or removed. Unsupported native strategies/CPO/archived states remain blocked.

## Runtime behavior and limits

Schedule/spend checks run every 60 seconds; bid decisions at most every 15 minutes. Decisions use the previous seven completed Moscow days, compare the previous seven-day baseline, preserve unknown metrics, and limit per-step movement to -10% / +0–5%, clamped to user bounds. Budget is never automatically raised. At 90% of the daily threshold or 95% of the weekly threshold, the controller pauses. Native weekly Ozon cap is checked each cycle. Provider reporting latency means daily spend cannot be guaranteed to the kopeck; delayed costs may arrive after pause. This must remain visible to the user.

Writes have a persisted intent before request and a readback after acknowledgment. Timeouts/rejected or mismatched writes halt control without replay. Journal is persisted with configuration. On read/API errors control halts; advertisements may remain running under the last Ozon configuration and native cap. UI discloses this. User can stop bot and advertising, or reconcile (stops advertising, reads state, records it, clears error, keeps bot disabled) before explicitly reenabling.

A manual campaign pause is respected after initial activation: only the bot's own recorded pauses may resume. An external native weekly-cap change halts control. Stop/reconcile never reenable control.

## Unclean shutdown recovery

Leave ads paused while reviewing `state.json` and the intent/confirmation journal. Verify actual campaign state and bids in Ozon. Do not delete state.json. Stop the old process and confirm there is no other worker before removing the stale `worker.lock` directory. Restart, use Reconcile for pending actions, review settings and explicitly reenable. Never remove a live worker's lock.

## Tests and rollout

Run all Node tests with jsdom available. Deploy with control flags absent first. Confirm /health and authenticated control state show ready=false and POST changes are blocked. Only after infrastructure approval configure persistence/flags, deploy again, and verify ready=true. Do not enable a live campaign without concrete user-entered min/max bids and spend caps.

Official API reviewed: https://docs.ozon.ru/api/performance/ ; GET /api/client/campaign; GET /api/client/campaign/{id}/v2/products; PATCH /api/client/campaign/{id} weeklyBudget; PUT /api/client/campaign/{id}/products; POST activate/deactivate. Money uses millionths of RUB. Never use retired daily_budget endpoint.
