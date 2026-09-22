-- 2026-09-22-microsites-home-singleton.sql — the reserved `home` page is a SINGLETON: exactly one
-- row per owner, in any status. Enforce it structurally so no code path can leave a second.
--
-- First reconcile any owner that already has more than one `home` row — the residue of the earlier
-- bug where home could be soft-deleted and then recreated (a live row plus a 'deleted' tombstone).
-- Keep one per owner: a non-deleted row if present, else the newest; drop the rest. A dropped row's
-- builds cascade (FK ON DELETE CASCADE) — correct, they belong to a home that no longer exists.
--
-- Reentrant: once an owner has a single home row it is its own keeper, so the DELETE matches
-- nothing on a rerun; the index is created IF NOT EXISTS.
DELETE FROM microsites m
WHERE m.slug = 'home'
  AND m.id <> (
    SELECT keep.id FROM microsites keep
    WHERE keep.owner_id = m.owner_id AND keep.slug = 'home'
    ORDER BY (keep.status = 'deleted'), keep.created_at DESC
    LIMIT 1
  );

-- Then forbid a second home row per owner, in ANY status — the structural singleton guarantee.
-- (The general microsites_owner_slug_idx only forbids two LIVE rows sharing a slug; this is
-- stricter for `home`: at most one, live or dead, so a tombstone can never reappear.)
CREATE UNIQUE INDEX IF NOT EXISTS microsites_one_home_per_owner
    ON microsites(owner_id) WHERE slug = 'home';
