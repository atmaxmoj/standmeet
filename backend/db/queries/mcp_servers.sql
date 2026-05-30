-- name: CreateMCPServer :one
INSERT INTO mcp_servers (owner_id, name, url, auth_header_name, auth_header_value_enc)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, owner_id, name, url, auth_header_name, auth_header_value_enc, created_at;

-- name: ListMCPServersByOwner :many
SELECT id, owner_id, name, url, auth_header_name, auth_header_value_enc, created_at
FROM mcp_servers
WHERE owner_id = $1
ORDER BY name ASC;

-- name: GetMCPServerByID :one
SELECT id, owner_id, name, url, auth_header_name, auth_header_value_enc, created_at
FROM mcp_servers
WHERE id = $1 AND owner_id = $2;

-- name: DeleteMCPServer :exec
DELETE FROM mcp_servers
WHERE id = $1 AND owner_id = $2;

-- A.3-IAM-5: AttachCodeMCPServers / ClearCodeMCPServers / ListMCPServerIDsForCode /
-- ListMCPServersForCode 都删了 —— code_mcp_servers 表已 drop，mcp 通过
-- role_mcp_servers 挂在 Role 上。
