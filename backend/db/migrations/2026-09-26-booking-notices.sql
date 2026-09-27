-- 2026-09-26-booking-notices.sql — the owner's booking notice travels as a durable job
-- (docs/design/event-bus-outbox-webhooks.md, *Phase 4*). Reentrant: safe to run on a database
-- that already has it.

-- booking_notices —— the owner's "new booking" mail, waiting for its owner.notify job. Written in
-- the same transaction as the booking.created event, deleted once sent.
CREATE TABLE IF NOT EXISTS booking_notices (
    owner_id      uuid        NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    booking_id    text        NOT NULL,
    summary       text        NOT NULL,
    visitor_name  text        NOT NULL DEFAULT '',
    start_at      timestamptz NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, booking_id)
);
