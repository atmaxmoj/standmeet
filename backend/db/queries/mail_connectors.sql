-- name: UpsertMailConnector :one
-- 写入或覆盖 owner/provider 的 SMTP 配置。改 credentials 必须重新 test，所以
-- connected_at 清回 NULL（区别于 calendar：那边改 client 不动 token）。
INSERT INTO owner_mail_connectors (
    owner_id, provider, host, port, username_enc, password_enc, from_address, from_name
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (owner_id, provider) DO UPDATE
SET host = EXCLUDED.host,
    port = EXCLUDED.port,
    username_enc = EXCLUDED.username_enc,
    password_enc = EXCLUDED.password_enc,
    from_address = EXCLUDED.from_address,
    from_name = EXCLUDED.from_name,
    connected_at = NULL,
    updated_at = now()
RETURNING *;

-- name: GetMailConnector :one
SELECT * FROM owner_mail_connectors
WHERE owner_id = $1 AND provider = $2;

-- name: MarkMailConnected :exec
-- test send 成功后标记 connected（凭据可用）。
UPDATE owner_mail_connectors
SET connected_at = now(), updated_at = now()
WHERE owner_id = $1 AND provider = $2;

-- name: DeleteMailConnector :exec
DELETE FROM owner_mail_connectors
WHERE owner_id = $1 AND provider = $2;
