-- name: CreateMCPServer :one
INSERT INTO mcp_servers (owner_id, name, url, auth_header_name, auth_header_value_enc)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, owner_id, name, url, auth_header_name, auth_header_value_enc, granted_deps, created_at;

-- name: ListMCPServersByOwner :many
SELECT id, owner_id, name, url, auth_header_name, auth_header_value_enc, granted_deps, created_at
FROM mcp_servers
WHERE owner_id = $1
ORDER BY name ASC;

-- name: GetMCPServerByID :one
SELECT id, owner_id, name, url, auth_header_name, auth_header_value_enc, granted_deps, created_at
FROM mcp_servers
WHERE id = $1 AND owner_id = $2;

-- name: DeleteMCPServer :exec
DELETE FROM mcp_servers
WHERE id = $1 AND owner_id = $2;

-- GrantMCPServerDep —— owner explicitly authorizes this server to use a connector dependency (dep name).
-- Idempotent: if already in granted_deps, do not append again.
-- name: GrantMCPServerDep :exec
UPDATE mcp_servers
SET granted_deps = array_append(granted_deps, $3)
WHERE id = $1 AND owner_id = $2 AND NOT ($3 = ANY(granted_deps));

-- A.3-IAM-5: AttachCodeMCPServers / ClearCodeMCPServers / ListMCPServerIDsForCode /
-- ListMCPServersForCode were all removed —— the code_mcp_servers table was dropped; mcp now hangs off the
-- Role via role_mcp_servers.
