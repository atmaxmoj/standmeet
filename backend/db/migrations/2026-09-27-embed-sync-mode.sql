-- 2026-09-27-embed-sync-mode.sql — how the site behind an embed keeps up with the corpus
-- (docs/design/event-bus-outbox-webhooks.md, *Embed sync mode*). Reentrant: safe to run on a
-- database that already has it.
--
-- sync_mode —— 'copy': the site keeps a copy and the embed's update hook tells it what changed;
-- 'live': the site reads the instance per request and has no hook. An embed that already has a
-- hook comes out 'copy'; every other embed 'live'.
-- events: none (instance configuration)
ALTER TABLE embeds ADD COLUMN IF NOT EXISTS sync_mode text;

UPDATE embeds e
SET sync_mode = CASE
    WHEN EXISTS (SELECT 1 FROM webhook_endpoints w WHERE w.embed_id = e.id) THEN 'copy'
    ELSE 'live'
END
WHERE sync_mode IS NULL;

ALTER TABLE embeds ALTER COLUMN sync_mode SET DEFAULT 'live';
ALTER TABLE embeds ALTER COLUMN sync_mode SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'embeds_sync_mode_check') THEN
        ALTER TABLE embeds ADD CONSTRAINT embeds_sync_mode_check CHECK (sync_mode IN ('live', 'copy'));
    END IF;
END $$;
