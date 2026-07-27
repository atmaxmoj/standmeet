-- name: UpsertMailConnector :one
-- 写入或覆盖 owner/provider 的 SMTP 配置。改 credentials 必须重新验证，所以
-- connected_at 清回 NULL + 作废任何待验 OTP（区别于 calendar：那边改 client 不动 token）。
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
    otp_hash = NULL,
    otp_expires_at = NULL,
    otp_attempts = 0,
    updated_at = now()
RETURNING *;

-- name: GetMailConnector :one
SELECT * FROM owner_mail_connectors
WHERE owner_id = $1 AND provider = $2;

-- name: MarkMailConnected :exec
-- OTP 验证通过后标记 connected，并清掉用过的 OTP。
UPDATE owner_mail_connectors
SET connected_at = now(),
    otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0,
    updated_at = now()
WHERE owner_id = $1 AND provider = $2;

-- name: DeleteMailConnector :exec
DELETE FROM owner_mail_connectors
WHERE owner_id = $1 AND provider = $2;

-- name: SetMailOTP :exec
-- 发码：存 sha256(code) + 过期时间，重置尝试计数。
UPDATE owner_mail_connectors
SET otp_hash = $3, otp_expires_at = $4, otp_attempts = 0, updated_at = now()
WHERE owner_id = $1 AND provider = $2;

-- name: IncMailOTPAttempts :one
-- 验码错一次：尝试计数 +1，返回新值（caller 据此判是否达上限作废）。
UPDATE owner_mail_connectors
SET otp_attempts = otp_attempts + 1, updated_at = now()
WHERE owner_id = $1 AND provider = $2
RETURNING otp_attempts;

-- name: ClearMailOTP :exec
-- 作废当前 OTP（达尝试上限 / 主动清）。
UPDATE owner_mail_connectors
SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, updated_at = now()
WHERE owner_id = $1 AND provider = $2;
