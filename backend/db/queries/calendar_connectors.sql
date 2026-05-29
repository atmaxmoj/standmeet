-- name: UpsertCalendarCredentials :one
-- 写入或覆盖 owner/provider 的 OAuth client_id + client_secret 加密对。
-- access_token / refresh_token 故意保留 (NULL → keep existing) —— 改
-- credentials 不应当让已授权的 token 失效；owner 真要 reset 走 Disconnect。
INSERT INTO owner_calendar_connectors (
    owner_id, provider, client_id_enc, client_secret_enc
)
VALUES ($1, $2, $3, $4)
ON CONFLICT (owner_id, provider) DO UPDATE
SET client_id_enc = EXCLUDED.client_id_enc,
    client_secret_enc = EXCLUDED.client_secret_enc,
    updated_at = now()
RETURNING *;

-- name: UpdateCalendarTokens :one
-- OAuth callback 拿到首次 token，或 refresh 路径拿到新 access_token。
-- refresh_token 可能 NULL（refresh 路径 google 通常不返回新 refresh，
-- 我们保留旧的）。
UPDATE owner_calendar_connectors
SET access_token_enc = sqlc.arg(access_token_enc)::bytea,
    refresh_token_enc = CASE
        WHEN length(sqlc.arg(refresh_token_enc)::bytea) > 0
        THEN sqlc.arg(refresh_token_enc)::bytea
        ELSE refresh_token_enc
    END,
    access_token_expires_at = sqlc.arg(access_token_expires_at)::timestamptz,
    scopes = sqlc.arg(scopes)::jsonb,
    connected_at = COALESCE(connected_at, now()),
    updated_at = now()
WHERE owner_id = sqlc.arg(owner_id) AND provider = sqlc.arg(provider)
RETURNING *;

-- name: GetCalendarConnector :one
SELECT * FROM owner_calendar_connectors
WHERE owner_id = $1 AND provider = $2;

-- name: DeleteCalendarConnector :exec
DELETE FROM owner_calendar_connectors
WHERE owner_id = $1 AND provider = $2;

-- name: ClearCalendarTokens :exec
-- Soft-disconnect: keep client_id/secret (owner already pasted them), but
-- wipe OAuth tokens + scopes so Authorize works again with one click.
UPDATE owner_calendar_connectors
SET access_token_enc = '\x'::bytea,
    refresh_token_enc = '\x'::bytea,
    access_token_expires_at = NULL,
    scopes = '[]'::jsonb,
    connected_at = NULL,
    updated_at = now()
WHERE owner_id = $1 AND provider = $2;
