-- 2026-09-26-webhook-endpoints.sql — where the owner's webhook events go
-- (docs/design/event-bus-outbox-webhooks.md, *Webhook endpoints*). Reentrant: safe to run on a
-- database that already has it.

-- webhook_endpoints —— one receiver of thin, signed events. The secret is sealed at rest
-- (cryptobox, AAD = owner id). failing_since starts the cooldown and the 5-day auto-disable;
-- busy_until is the per-endpoint lease that keeps at most one delivery in flight.
-- events: none (instance configuration)
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    url             text        NOT NULL,
    description     text        NOT NULL DEFAULT '',
    -- event_types —— exact types or dotted globs ("corpus.note.*").
    event_types     text[]      NOT NULL DEFAULT '{}',
    secret_enc      bytea       NOT NULL,
    -- embed_id —— the scope source; NULL = standalone (the published slice).
    embed_id        uuid        NULL REFERENCES embeds(id) ON DELETE CASCADE,
    enabled         boolean     NOT NULL DEFAULT true,
    disabled_reason text        NOT NULL DEFAULT '',
    failing_since   timestamptz NULL,
    busy_until      timestamptz NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_owner_idx ON webhook_endpoints (owner_id);
