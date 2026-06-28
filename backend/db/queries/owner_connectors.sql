-- owner_connectors.sql —— #155 统一连接器连接状态的读写（归一：任意 kind/品类一张表）。

-- name: UpsertConnectorCredentials :one
-- 存/覆盖一个连接器的凭据（owner 填的 app creds / apiKey / smtp config）。轮换凭据 → 重置
-- connected_at（§三 D-5：改身份/凭据必须重新验证；非凭据配置如 booking policy 不走这条，不
-- 受影响）。category/kind 随首次写入定。
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
    connected_at = NULL,
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

-- name: InsertUploadedConnector :one
-- 上传一个 openapi 连接器（owner 在 UI 贴 spec + JSONata binding）：建行并存下 manifest
-- （spec/binding/auth_scheme），首次未连。category/kind 由 binding 定。
INSERT INTO owner_connectors (
    owner_id, connector_id, category, kind, spec, binding, auth_scheme
)
VALUES (
    sqlc.arg(owner_id), sqlc.arg(connector_id), sqlc.arg(category),
    sqlc.arg(kind), sqlc.arg(spec)::bytea, sqlc.arg(binding)::bytea, sqlc.arg(auth_scheme)
)
RETURNING *;

-- name: GetConnectorManifest :one
-- 取一个连接器存档的 manifest 字段（上传连接器有 spec/binding；内置的这些为空）。
SELECT category, kind, spec, binding, auth_scheme
FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: ListUploadedConnectors :many
-- 拉起时重装：所有带 spec 的（上传的）连接器，跨 owner（v1 单 owner；Hub 按 connector_id）。
SELECT DISTINCT ON (connector_id)
    connector_id, category, kind, spec, binding, auth_scheme
FROM owner_connectors
WHERE length(spec) > 0
ORDER BY connector_id, updated_at DESC;
