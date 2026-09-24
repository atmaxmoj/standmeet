-- public_conversation_policy —— how the owner keeps codeless (public / byoai) conversations:
-- whether their messages are saved at all, and a schedule deleting idle ones. Additive +
-- idempotent: a live instance gets an empty table, which reads as "save, no prune" — today's
-- behaviour — until the owner changes it.
CREATE TABLE IF NOT EXISTS public_conversation_policy (
    owner_id        uuid          PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
    save            boolean       NOT NULL DEFAULT true,
    prune_cron      text          NOT NULL DEFAULT '',
    retention_days  integer       NOT NULL DEFAULT 30,
    last_run_at     timestamptz   NOT NULL DEFAULT now()
);
