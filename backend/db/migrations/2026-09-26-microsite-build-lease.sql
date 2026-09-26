-- microsite_builds.claimed_at —— the lease on a build a builder is working on. The builder
-- refreshes it while it builds; a `building` row whose lease has run out belongs to a builder
-- that is gone (killed by an upgrade, OOM, a host restart) and is claimable again. Without it such
-- a row stayed `building` forever (prod, 2026-09-26). Additive + idempotent: existing rows get
-- NULL, which reads as "no live lease" — a row stuck before this migration is reclaimed too.
ALTER TABLE microsite_builds ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
