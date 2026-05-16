-- name: CreateOwner :one
INSERT INTO owners (email, password_hash, handle, full_name)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: GetOwnerByEmail :one
SELECT * FROM owners WHERE email = $1;

-- name: GetOwnerByID :one
SELECT * FROM owners WHERE id = $1;

-- name: CountOwners :one
SELECT COUNT(*) FROM owners;
