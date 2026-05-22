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
    ai_provider_key_enc = $3
WHERE id = $1
RETURNING *;

-- name: UpdateOwnerPublicURL :one
UPDATE owners
SET public_url = $2
WHERE id = $1
RETURNING *;
