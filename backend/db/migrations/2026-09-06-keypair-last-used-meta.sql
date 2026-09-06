-- 2026-09-06-keypair-last-used-meta.sql — record WHERE an owner-MCP keypair was last used, not just
-- WHEN. The management panel already showed each keypair's label / created / last-used time; the
-- owner also wants to see the device (user-agent) and IP of the last signed request, so a leaked or
-- stale key is recognizable at a glance before revoking it.
--
-- Nullable, no default: existing keypairs (and any never used since this migration) simply show
-- no device/IP until their next signed request stamps one. IF NOT EXISTS makes it a no-op on a
-- fresh install (schema.sql already has the columns) and safe to re-run.
ALTER TABLE owner_keypairs ADD COLUMN IF NOT EXISTS last_used_ip text;
ALTER TABLE owner_keypairs ADD COLUMN IF NOT EXISTS last_used_user_agent text;
