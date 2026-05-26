-- name: CreateOwner :one
INSERT INTO owners (email, password_hash, handle, full_name, public_url)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetOwnerByEmail :one
SELECT * FROM owners WHERE email = $1;

-- name: GetOwnerByID :one
SELECT * FROM owners WHERE id = $1;

-- name: GetOwnerByHandle :one
SELECT * FROM owners WHERE handle = $1;

-- name: CountOwners :one
SELECT COUNT(*) FROM owners;

-- name: GetFirstOwnerHandle :one
-- v1 单 owner instance：返回最早创建那位的 handle；app 根路径用来跳转。
SELECT handle FROM owners ORDER BY created_at ASC LIMIT 1;

-- name: UpdateOwnerBYOAI :one
UPDATE owners
SET byoai_enabled = $2,
    byoai_providers = $3,
    byoai_public_blurb = $4
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerAIProvider :one
UPDATE owners
SET ai_provider = $2,
    ai_provider_key_enc = $3,
    ai_endpoint = $4,
    ai_model = $5
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerPublicURL :one
UPDATE owners
SET public_url = $2
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerFullName :one
UPDATE owners
SET full_name = $2
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerEmail :one
UPDATE owners
SET email = $2
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerPasswordHash :one
UPDATE owners
SET password_hash = $2
WHERE id = $1
RETURNING *;

-- name: GetOwnerPasswordHash :one
SELECT password_hash FROM owners WHERE id = $1;

-- name: SetPasswordResetToken :exec
-- 紧急 reset token：写 hash + 当前时间。每 owner 同时只允许一个 reset
-- token；旧的被新的覆盖（"重新跑命令"也是合法 UX）。
UPDATE owners SET password_reset_hash = $2, password_reset_at = NOW() WHERE id = $1;

-- name: GetFirstOwnerResetToken :one
-- single-owner self-host：reset 流程通过 sole owner 找回。返 owner_id + hash
-- + at 让 usecase 比对 + 检 TTL。表为空 → ErrNoRows，caller 翻 unauthorized。
SELECT id, password_reset_hash, password_reset_at FROM owners
ORDER BY created_at ASC LIMIT 1;

-- name: ClearPasswordResetToken :exec
-- reset 成功后清掉，让 token 一次性。
UPDATE owners SET password_reset_hash = ''::bytea, password_reset_at = NULL WHERE id = $1;
