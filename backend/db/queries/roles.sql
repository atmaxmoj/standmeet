-- roles —— owner-scoped visitor 身份原型。语义见 schema.sql + [[iam-role-pivot-plan]]。
--
-- Role 持的 corpus URI / skills / mcp servers 走对应 join 表（role_corpus_uris /
-- role_skills / role_mcp_servers）。这里只 CRUD 主表行 + join 表的 attach/clear。

-- name: CreateRole :one
INSERT INTO roles (owner_id, name, description, prompt_id)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpsertBuiltinRole :one
-- Seed vanilla role：idempotent by (owner_id, name)。
INSERT INTO roles (owner_id, name, description, prompt_id, is_builtin)
VALUES ($1, $2, $3, $4, true)
ON CONFLICT (owner_id, name) DO UPDATE SET
    description = EXCLUDED.description,
    prompt_id   = EXCLUDED.prompt_id,
    updated_at  = now()
RETURNING *;

-- name: GetRoleByID :one
SELECT * FROM roles WHERE id = $1 AND owner_id = $2;

-- name: GetRoleByName :one
SELECT * FROM roles WHERE owner_id = $1 AND name = $2;

-- name: ListRolesByOwner :many
SELECT * FROM roles WHERE owner_id = $1 ORDER BY is_builtin DESC, name ASC;

-- name: UpdateRole :one
UPDATE roles
SET name = $3, description = $4, prompt_id = $5, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- name: DeleteRole :exec
DELETE FROM roles WHERE id = $1 AND owner_id = $2 AND is_builtin = false;

-- name: ClearRoleCorpusURIs :exec
DELETE FROM role_corpus_uris WHERE role_id = $1;

-- name: AttachRoleCorpusURIs :exec
-- bulk insert from text[]。caller 已 ClearRoleCorpusURIs。
INSERT INTO role_corpus_uris (role_id, uri_pattern)
SELECT $1, unnest($2::text[])
ON CONFLICT DO NOTHING;

-- name: ListRoleCorpusURIs :many
SELECT uri_pattern FROM role_corpus_uris WHERE role_id = $1 ORDER BY uri_pattern ASC;

-- name: ClearRoleSkills :exec
DELETE FROM role_skills WHERE role_id = $1;

-- name: AttachRoleSkills :exec
INSERT INTO role_skills (role_id, skill_id)
SELECT $1, unnest($2::uuid[])
ON CONFLICT DO NOTHING;

-- name: ListRoleSkillIDs :many
SELECT skill_id FROM role_skills WHERE role_id = $1 ORDER BY skill_id ASC;

-- name: ListRoleSkills :many
-- session issue 时拿 skills 拼 system prompt。
SELECT s.* FROM skills s
JOIN role_skills rs ON rs.skill_id = s.id
WHERE rs.role_id = $1
ORDER BY s.name ASC;

-- name: ClearRoleMCPServers :exec
DELETE FROM role_mcp_servers WHERE role_id = $1;

-- name: AttachRoleMCPServers :exec
INSERT INTO role_mcp_servers (role_id, mcp_server_id)
SELECT $1, unnest($2::uuid[])
ON CONFLICT DO NOTHING;

-- name: ListRoleMCPServerIDs :many
SELECT mcp_server_id FROM role_mcp_servers WHERE role_id = $1 ORDER BY mcp_server_id ASC;

-- name: ListRoleMCPServers :many
-- session issue 时拿 MCP servers 拼 ext-server tool 列表。
SELECT m.* FROM mcp_servers m
JOIN role_mcp_servers rms ON rms.mcp_server_id = m.id
WHERE rms.role_id = $1
ORDER BY m.name ASC;

-- name: CountActiveCodesForRole :one
-- /admin/roles 卡上 "N active codes" 指标。
SELECT COUNT(*)::bigint FROM access_codes
WHERE assumed_role_id = $1 AND status = 'active';
