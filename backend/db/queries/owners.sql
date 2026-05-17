-- name: CreateOwner :one
INSERT INTO owners (email, password_hash, handle, full_name)
VALUES ($1, $2, $3, $4)
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
