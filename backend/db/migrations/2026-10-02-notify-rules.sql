-- 2026-10-02-notify-rules.sql — notification rules, the owner's linked IM chats, and the
-- first-time markers (docs/design/notify-rules-and-live-transcript.md). Reentrant: safe to run on
-- a database that already has them.

-- im_links —— the owner's own IM chats the bridge may post to. A row starts with a pairing code
-- only; the owner sends that code to the bot, and the bridge fills in the chat id.
-- events: none (owner configuration)
CREATE TABLE IF NOT EXISTS im_links (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    platform      text        NOT NULL DEFAULT 'telegram',
    pairing_code  text        NOT NULL,
    chat_id       text        NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    paired_at     timestamptz NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS im_links_pairing_code_idx ON im_links (pairing_code);
CREATE INDEX IF NOT EXISTS im_links_owner_idx ON im_links (owner_id);

-- notify_rules —— event type (or glob) + filter + channel + the card's words. filter_key is '' (any),
-- 'subject', or a data key the event type declares filterable. channel is webhook | email | im;
-- channel_ref names the webhook endpoint or the im link.
-- events: none (owner configuration)
CREATE TABLE IF NOT EXISTS notify_rules (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id      uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    event_type    text        NOT NULL,
    filter_key    text        NOT NULL DEFAULT '',
    filter_value  text        NOT NULL DEFAULT '',
    first_only    boolean     NOT NULL DEFAULT false,
    channel       text        NOT NULL,
    channel_ref   text        NOT NULL DEFAULT '',
    template      text        NOT NULL DEFAULT '',
    enabled       boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notify_rules_owner_idx ON notify_rules (owner_id);

-- notify_rule_marks —— a first-only rule fired once for this mark (the filter value, else the
-- event's subject). Claimed in the same transaction that queues the delivery, so a retried
-- fan-out never sends twice.
-- events: none (delivery bookkeeping)
CREATE TABLE IF NOT EXISTS notify_rule_marks (
    rule_id       uuid        NOT NULL REFERENCES notify_rules(id) ON DELETE CASCADE,
    mark          text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (rule_id, mark)
);
