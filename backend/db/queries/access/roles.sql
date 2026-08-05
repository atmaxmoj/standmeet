-- roles —— owner-scoped visitor 身份原型。语义见 schema.sql + [[iam-role-pivot-plan]]。
--
-- Role 持的 corpus URI / skills / mcp servers 走对应 join 表（role_corpus_uris /
-- role_skills / role_mcp_servers）。这里只 CRUD 主表行 + join 表的 attach/clear。

-- name: CreateRole :one
INSERT INTO roles (owner_id, name, description, greeting, prompt_id, dock_buttons)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpsertBuiltinRole :one
-- Seed public role：idempotent by (owner_id, name)。
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
SET name = $3, description = $4, greeting = $5, prompt_id = $6,
    dock_buttons = $7, require_ghost_evidence = $8, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- 这里以前有 RoleNotifiesOwnerOnBooking —— 一条专门为"约成时要不要通知 owner"写的 query。
-- 它有两个问题:一是 roles 表不该知道 booking 是什么(那个开关现在是 calendar.book 自己在
-- capconfig 的 role scope 上声明的);二是它**零调用方** —— 仓储上那个方法从来没有人调过,
-- 真正在用的一直是冻进 role snapshot 的那一份。

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

-- name: ClearRoleWaypoints :exec
DELETE FROM role_waypoints WHERE role_id = $1;

-- name: AttachRoleWaypoint :exec
-- 逐条 insert（waypoints 数量少 + evidence_refs 是 per-row jsonb，不走 unnest 批量）。
INSERT INTO role_waypoints (role_id, waypoint_id, description, weight, evidence_refs, is_terminal)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (role_id, waypoint_id) DO NOTHING;

-- name: ListRoleWaypoints :many
SELECT waypoint_id, description, weight, evidence_refs, is_terminal
FROM role_waypoints WHERE role_id = $1 ORDER BY weight DESC, waypoint_id ASC;

-- name: ClearRoleSkills :exec
DELETE FROM role_skills WHERE role_id = $1;

-- name: AttachRoleSkills :exec
INSERT INTO role_skills (role_id, skill_id)
SELECT $1, unnest($2::uuid[])
ON CONFLICT DO NOTHING;

-- name: ListRoleSkillIDs :many
SELECT skill_id FROM role_skills WHERE role_id = $1 ORDER BY skill_id ASC;

-- name: ClearRoleMCPServers :exec
DELETE FROM role_mcp_servers WHERE role_id = $1;

-- name: AttachRoleMCPServers :exec
INSERT INTO role_mcp_servers (role_id, mcp_server_id)
SELECT $1, unnest($2::uuid[])
ON CONFLICT DO NOTHING;

-- name: ListRoleMCPServerIDs :many
SELECT mcp_server_id FROM role_mcp_servers WHERE role_id = $1 ORDER BY mcp_server_id ASC;

-- name: CountActiveCodesForRole :one
-- /admin/roles 卡上 "N active codes" 指标。
SELECT COUNT(*)::bigint FROM access_codes
WHERE assumed_role_id = $1 AND status = 'active';
