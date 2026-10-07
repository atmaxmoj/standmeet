-- 2026-10-07-keypair-scopes.sql — an owner MCP key carries the danger classes it may use
-- (refactor ledger R7). Reentrant: safe to run on a database that already has it.
--
-- A key pasted into a third-party AI client was the whole instance. The owner MCP face now lists
-- and runs only the tools whose class (facadeparity.Danger) is in the key's scopes. Existing keys
-- get every class, so a key already handed out behaves as before.
-- events: none (owner configuration)
ALTER TABLE owner_keypairs
    ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL
        DEFAULT '{read,write,destructive,credential,authority,spend,egress}';
