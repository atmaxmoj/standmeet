-- 2026-09-26-gas-exhausted.sql — gas.exhausted fires once per fill
-- (docs/design/event-bus-outbox-webhooks.md, *Webhook event types*). Reentrant.

-- gas_exhausted_at —— when the gate last found this tank dry; the event is recorded only when it
-- moves past gas_filled_at, in the same transaction.
ALTER TABLE owner_providers ADD COLUMN IF NOT EXISTS gas_exhausted_at timestamptz;
