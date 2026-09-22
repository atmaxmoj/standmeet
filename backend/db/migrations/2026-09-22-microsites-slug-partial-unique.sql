-- 2026-09-22-microsites-slug-partial-unique.sql — a soft-deleted microsite slug must free up.
--
-- microsites_owner_slug_idx was UNIQUE over ALL rows. DeletePage soft-deletes (status='deleted'),
-- so the (owner_id, slug) pair stayed occupied forever: recreating that slug failed with "slug
-- already taken", and GetMicrositeBySlug (status <> 'deleted') couldn't see the dead row to
-- restore it either. The reserved `home` page is the worst case — once deleted, `/` was pinned to
-- the fallback with no product path back. Make the index PARTIAL so uniqueness holds only among
-- live rows; a deleted slug is then recreatable.
--
-- Reentrant: DROP IF EXISTS + CREATE IF NOT EXISTS. On a fresh volume schema.sql already builds
-- the partial index, so this drops and recreates the same shape (no-op in effect); on an old
-- volume it converts the full index to partial. No two LIVE rows share (owner_id, slug) today (the
-- full index guaranteed it), so the partial index builds cleanly.
DROP INDEX IF EXISTS microsites_owner_slug_idx;
CREATE UNIQUE INDEX IF NOT EXISTS microsites_owner_slug_idx
    ON microsites(owner_id, slug) WHERE status <> 'deleted';
