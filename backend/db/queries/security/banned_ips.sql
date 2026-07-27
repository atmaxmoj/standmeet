-- name: BanIP :one
-- 封一个 IP。重复封同一 (owner, ip) 覆盖 reason/expires_at 并刷新 created_at
-- (等于「重新封」)。
INSERT INTO banned_ips (owner_id, ip, reason, expires_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (owner_id, ip) DO UPDATE
SET reason = EXCLUDED.reason,
    expires_at = EXCLUDED.expires_at,
    created_at = now()
RETURNING *;

-- name: ListBannedIPs :many
SELECT * FROM banned_ips
WHERE owner_id = $1
ORDER BY created_at DESC;

-- name: UnbanIPByID :exec
DELETE FROM banned_ips
WHERE id = $1 AND owner_id = $2;

-- name: IsIPBanned :one
-- enforcement 查询：该 owner 是否封了这个 IP 且未过期。expires_at IS NULL =
-- 永久。返回布尔。
SELECT EXISTS (
    SELECT 1 FROM banned_ips
    WHERE owner_id = $1 AND ip = $2
      AND (expires_at IS NULL OR expires_at > now())
) AS banned;

-- name: IsIPBannedAnywhere :one
-- 公开面 enforcement 用：这个 IP 在本实例上是否被任何 owner 封了且未过期。
-- v1 单 owner，等价于「sole owner 封没封」，但不需 middleware 解析 owner。
-- 多租户起再换成 host→owner 作用域。
SELECT EXISTS (
    SELECT 1 FROM banned_ips
    WHERE ip = $1 AND (expires_at IS NULL OR expires_at > now())
) AS banned;
