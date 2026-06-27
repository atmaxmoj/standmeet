-- owner_connectors.sql —— #155 统一连接器连接状态的读写（归一：任意 kind/品类一张表）。

-- name: UpsertConnectorCredentials :one
-- 存/覆盖一个连接器的凭据（owner 填的 app creds / apiKey / smtp config）。改 creds 不动
-- 已有 token（owner 要 reset 走 Disconnect）。category/kind 随首次写入定。
INSERT INTO owner_connectors (
    owner_id, connector_id, category, kind, credentials_enc
)
VALUES (
    sqlc.arg(owner_id), sqlc.arg(connector_id), sqlc.arg(category),
    sqlc.arg(kind), sqlc.arg(credentials_enc)::bytea
)
ON CONFLICT (owner_id, connector_id) DO UPDATE
SET credentials_enc = EXCLUDED.credentials_enc,
    category = EXCLUDED.category,
    kind = EXCLUDED.kind,
    updated_at = now()
RETURNING *;

-- name: UpdateConnectorTokens :one
-- OAuth 拿到首次 token，或 refresh 路径拿到新 access_token。首次拿到 token → connected。
UPDATE owner_connectors
SET token_enc = sqlc.arg(token_enc)::bytea,
    token_expires_at = sqlc.arg(token_expires_at)::timestamptz,
    scopes = sqlc.arg(scopes)::jsonb,
    connected_at = COALESCE(connected_at, now()),
    updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id)
RETURNING *;

-- name: MarkConnectorConnected :exec
-- protocol 连接器验证通过（无 oauth dance）→ 标记 connected。
UPDATE owner_connectors
SET connected_at = COALESCE(connected_at, now()), updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: ClearConnectorTokens :exec
-- soft disconnect：擦 token + connected + active，保留 credentials（一键重连不重填）。
UPDATE owner_connectors
SET token_enc = '\x'::bytea, token_expires_at = NULL,
    connected_at = NULL, active = false, updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: SetActiveConnector :exec
-- 一个品类槽同时只一个 active：把目标置 active、同品类其余置非 active（§9 槽位规则）。
UPDATE owner_connectors
SET active = (connector_id = sqlc.arg(connector_id)::text), updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND category = sqlc.arg(category);

-- name: GetConnector :one
SELECT * FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: ListConnectorsByOwner :many
SELECT * FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id)
ORDER BY category, connector_id;

-- name: ListConnectorsByCategory :many
SELECT * FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND category = sqlc.arg(category)
ORDER BY connector_id;

-- name: DeleteConnector :exec
DELETE FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);
