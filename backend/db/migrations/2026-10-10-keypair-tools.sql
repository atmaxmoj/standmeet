-- 2026-10-10-keypair-tools.sql — an owner MCP key may name the only tools it calls (job-loop
-- roadmap 8.5.a). Reentrant: safe to run on a database that already has it.
--
-- Job Scout is the owner's own agent and needs a handful of jobs.* tools; a key with every write
-- tool would let it delete the corpus. Empty = every tool the key's scopes cover, so every existing
-- key behaves as before.
-- events: none (owner configuration)
ALTER TABLE owner_keypairs ADD COLUMN IF NOT EXISTS tools text[] NOT NULL DEFAULT '{}';
