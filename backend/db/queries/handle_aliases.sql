-- name: GetOwnerByHandleAlias :one
-- handle 不在 owners.handle 上时走这里：owner 改名后旧 handle 入 alias 表。
SELECT o.id, o.email, o.handle, o.full_name, o.location,
       o.byoai_enabled, o.byoai_providers, o.byoai_public_blurb, o.created_at
FROM owners o
JOIN handle_aliases a ON a.owner_id = o.id
WHERE a.handle = $1;

-- name: AddHandleAlias :exec
-- owner 改 handle 时把旧 handle 写进 alias 表。冲突（旧 handle 之前已经
-- alias 过 / 其它 owner 占用）忽略——alias 唯一即可。
INSERT INTO handle_aliases (handle, owner_id)
VALUES ($1, $2)
ON CONFLICT (handle) DO NOTHING;

-- name: UpdateOwnerHandle :one
-- 把 owners.handle 设成新值，返回更新后的 row 给 GetByID 形状的回调用。
UPDATE owners
SET handle = $2
WHERE id = $1
RETURNING id, email, handle, full_name, location,
          byoai_enabled, byoai_providers, byoai_public_blurb, created_at;
