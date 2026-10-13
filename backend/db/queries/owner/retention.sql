-- retention.sql —— the one clock of ephemeral things (docs/design/job-loop-retention.md).

-- name: CreateRetentionBundle :one
INSERT INTO retention_bundles (owner_id) VALUES ($1) RETURNING id;

-- name: RetentionBundleLive :one
-- The bundle exists, is the owner's, and has not been cleared.
SELECT EXISTS (
    SELECT 1 FROM retention_bundles WHERE id = $1 AND owner_id = $2 AND cleared_at IS NULL
);

-- name: TouchRetentionBundle :exec
UPDATE retention_bundles SET last_touched_at = now()
WHERE id = $1 AND owner_id = $2 AND cleared_at IS NULL;

-- name: TouchPageBundle :exec
-- A touch on a page renews its bundle (a forever page has none: nothing happens).
UPDATE retention_bundles b SET last_touched_at = now()
FROM microsites m
WHERE m.id = $1 AND b.id = m.bundle_id AND b.cleared_at IS NULL;

-- name: PinRetentionBundle :execrows
-- Pin or unpin; either is a touch, so an unpinned bundle starts a fresh 90 days.
UPDATE retention_bundles SET keep = $3, last_touched_at = now()
WHERE id = $1 AND owner_id = $2 AND cleared_at IS NULL;

-- name: SetPageBundle :execrows
UPDATE microsites SET bundle_id = $3 WHERE id = $1 AND owner_id = $2;

-- name: DueRetentionBundles :many
-- Unpinned, uncleared bundles last touched before the cutoff.
SELECT id, owner_id FROM retention_bundles
WHERE cleared_at IS NULL AND NOT keep AND last_touched_at < $1
ORDER BY last_touched_at;

-- name: BundlePageIDs :many
SELECT id FROM microsites WHERE bundle_id = $1 AND status <> 'deleted';

-- name: ExpireBundlePages :exec
-- The clock ran out: the bundle's pages go to the trash, marked expired.
UPDATE microsites SET status = 'deleted', updated_at = now(), expired_at = now()
WHERE bundle_id = $1 AND status <> 'deleted';

-- name: ClearRetentionBundle :execrows
UPDATE retention_bundles SET cleared_at = now() WHERE id = $1 AND cleared_at IS NULL;

-- name: RestoreRetentionBundle :execrows
UPDATE retention_bundles SET cleared_at = NULL, last_touched_at = now()
WHERE id = $1 AND owner_id = $2 AND cleared_at IS NOT NULL;

-- name: RestoreBundlePages :exec
UPDATE microsites SET status = 'active', expired_at = NULL, updated_at = now()
WHERE bundle_id = $1 AND status = 'deleted' AND expired_at IS NOT NULL;

-- name: PageExpired :one
-- The newest page under this slug ran out of time (its URL then says "expired", not "not found").
SELECT EXISTS (
    SELECT 1 FROM microsites
    WHERE owner_id = $1 AND slug = $2 AND status = 'deleted' AND expired_at IS NOT NULL
);
