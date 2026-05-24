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

-- name: AttachCodeMCPServers :exec
INSERT INTO code_mcp_servers (code_id, mcp_server_id)
SELECT $1, sid
FROM unnest($2::uuid[]) AS sid
ON CONFLICT DO NOTHING;

-- name: ClearCodeMCPServers :exec
DELETE FROM code_mcp_servers WHERE code_id = $1;

-- name: ListMCPServerIDsForCode :many
SELECT mcp_server_id
FROM code_mcp_servers
WHERE code_id = $1
ORDER BY mcp_server_id ASC;

-- name: ListMCPServersForCode :many
SELECT s.id, s.owner_id, s.name, s.url, s.auth_header_name, s.auth_header_value_enc, s.created_at
FROM mcp_servers s
JOIN code_mcp_servers cs ON cs.mcp_server_id = s.id
WHERE cs.code_id = $1
ORDER BY s.name ASC;
