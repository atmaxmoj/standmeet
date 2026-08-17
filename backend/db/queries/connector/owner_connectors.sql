-- owner_connectors.sql —— #155 统一连接器连接状态的读写（归一：任意 kind/品类一张表）。

-- name: UpsertConnectorCredentials :one
-- 存/覆盖一个连接器的凭据（owner 填的 app creds / apiKey / smtp config）。category/kind 随
-- 首次写入定。
--
-- connected_at 由 `reset_connected` 决定，**而不是无条件清掉**（F-C-30）：
-- §三 D-5 要的是「改身份/凭据必须重新验证」—— 那是「**改了**」才该触发的规则。而面板点
-- Connect 的第一件事就是 POST /credentials，于是「已连接」在授权还没开始之前就没了；owner
-- 只要打开卡片重存一次（值一个字都没动），一条好端端的连接就显示成「没连」，而 token 还活着。
-- 调用方比对合并后的凭据跟原值：真的变了才传 true。
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
    connected_at = CASE
        WHEN sqlc.arg(reset_connected)::boolean THEN NULL
        ELSE owner_connectors.connected_at
    END,
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

-- name: MarkConnectorConnected :execrows
-- protocol 连接器验证通过（无 oauth dance）→ 标记 connected。
-- **:execrows,不是 :exec** —— 这一行是"存凭据"那步建的。owner 还没有它的时候,这条 UPDATE
-- 命中 0 行、不报错,调用方照样回 connected:true —— 一句谎话,而且每一次全新安装都踩得到。
-- 行数是这笔写入唯一的回执,调用方必须看它。
UPDATE owner_connectors
SET connected_at = COALESCE(connected_at, now()), updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: ClearConnectorTokens :exec
-- soft disconnect：擦 token + connected + active，保留 credentials（一键重连不重填）。
UPDATE owner_connectors
SET token_enc = '\x'::bytea, token_expires_at = NULL,
    connected_at = NULL, active = false, updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: SetActiveConnector :many
-- 一个品类槽同时只一个 active：把目标置 active、同品类其余置非 active（§9 槽位规则）。
-- **RETURNING 是回执。** 行数在这里证明不了什么：更新的是整个品类，目标行不在其中时其余全被
-- 置成非 active，行数照样大于 0 —— "激活"的结果是**这个品类一个 active 都没有**。所以回执
-- 必须是名字：调用方要看目标 connector_id 在不在里面。
UPDATE owner_connectors
SET active = (connector_id = sqlc.arg(connector_id)::text), updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND category = sqlc.arg(category)
RETURNING connector_id;

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
    owner_id, connector_id, category, kind, spec, binding, auth_scheme, protocol,
    expose_as_agent_tools
)
VALUES (
    sqlc.arg(owner_id), sqlc.arg(connector_id), sqlc.arg(category),
    sqlc.arg(kind), sqlc.arg(spec)::bytea, sqlc.arg(binding)::bytea,
    sqlc.arg(auth_scheme), sqlc.arg(protocol), sqlc.arg(expose_as_agent_tools)
)
RETURNING *;

-- name: UpdateUploadedConnector :exec
-- 编辑已建上传连接器的 spec/binding/auth_scheme（owner 在 UI 改 spec → 重新装配 + 重派生凭据
-- 表单）。换认证 type 后凭据需重新填，清掉 connected_at（重新连）。category 可能随之变。
UPDATE owner_connectors
SET spec = sqlc.arg(spec)::bytea, binding = sqlc.arg(binding)::bytea,
    category = sqlc.arg(category), auth_scheme = sqlc.arg(auth_scheme),
    expose_as_agent_tools = sqlc.arg(expose_as_agent_tools),
    connected_at = NULL, updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: GetConnectorManifest :one
-- 取一个连接器存档的 manifest 字段（上传连接器有 spec/binding；protocol 连接器有 protocol）。
SELECT category, kind, spec, binding, auth_scheme, protocol, expose_as_agent_tools
FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);

-- name: ListUploadedConnectors :many
-- 拉起时重装：所有 owner 自建连接器（带 spec 的 openapi + kind=protocol 协议连接器），跨 owner
-- （v1 单 owner；Hub 按 connector_id）。内置连接器 spec 空且 kind!=protocol，不在此列。
SELECT DISTINCT ON (connector_id)
    connector_id, category, kind, spec, binding, auth_scheme, protocol, expose_as_agent_tools
FROM owner_connectors
WHERE length(spec) > 0 OR kind = 'protocol'
ORDER BY connector_id, updated_at DESC;

-- name: DeleteUploadedConnector :exec
-- 删一个 owner 自建连接器（行删除）。它填的品类槽随之空（slot store 读不到 → cap 复闸）。
DELETE FROM owner_connectors
WHERE owner_id = sqlc.arg(owner_id) AND connector_id = sqlc.arg(connector_id);
