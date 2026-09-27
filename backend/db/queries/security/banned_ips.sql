-- name: BanIP :one
-- Ban an IP. Re-banning the same (owner, ip) overwrites reason/expires_at and refreshes created_at
-- (equivalent to "re-ban").
INSERT INTO banned_ips (owner_id, ip, reason, expires_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (owner_id, ip) DO UPDATE
SET reason = EXCLUDED.reason,
    expires_at = EXCLUDED.expires_at,
    created_at = now()
RETURNING *;

-- name: ListBannedIPsPage :many
-- One page of the owner's bans, newest first, expired ones included (docs/design/paging.md).
SELECT sqlc.embed(b),
  (SELECT COUNT(*) FROM banned_ips b2 WHERE b2.owner_id = sqlc.arg('owner_id'))::int AS total
FROM banned_ips b
WHERE b.owner_id = sqlc.arg('owner_id')
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (b.created_at, b.id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY b.created_at DESC, b.id DESC
LIMIT sqlc.arg('lim');

-- name: UnbanIPByID :exec
DELETE FROM banned_ips
WHERE id = $1 AND owner_id = $2;

-- name: IsIPBanned :one
-- enforcement query: has this owner banned this IP and it has not expired? expires_at IS NULL =
-- permanent. Returns a boolean.
SELECT EXISTS (
    SELECT 1 FROM banned_ips
    WHERE owner_id = $1 AND ip = $2
      AND (expires_at IS NULL OR expires_at > now())
) AS banned;

-- name: IsIPBannedAnywhere :one
-- For public-surface enforcement: is this IP banned by any owner on this instance and not expired?
-- v1 single owner, equivalent to "did the sole owner ban it", but without middleware resolving the owner.
-- Switch to host→owner scoping when multi-tenant arrives.
SELECT EXISTS (
    SELECT 1 FROM banned_ips
    WHERE ip = $1 AND (expires_at IS NULL OR expires_at > now())
) AS banned;
