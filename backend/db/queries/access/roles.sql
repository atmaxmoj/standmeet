-- roles -- owner-scoped visitor identity archetypes. Semantics in schema.sql + [[iam-role-pivot-plan]].
--
-- A role's corpus URIs / skills / mcp servers go through their respective join tables
-- (role_corpus_uris / role_skills / role_mcp_servers). Here we only CRUD the main table row +
-- attach/clear the join tables.

-- name: CreateRole :one
-- require_ghost_evidence must be accepted here too (F-Q-4). It used to appear only in UpdateRole --
-- so role_create took in this security switch, returned false, and the DB was false too, three
-- places consistently not taking effect.
INSERT INTO roles (
    owner_id, name, description, greeting, prompt_id, dock_buttons, provider_id, gas_metered,
    require_ghost_evidence
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: UpsertBuiltinRole :one
-- Seed public role: idempotent by (owner_id, name).
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
    dock_buttons = $7, require_ghost_evidence = $8,
    provider_id = $9, gas_metered = $10, updated_at = now()
WHERE id = $1 AND owner_id = $2
RETURNING *;

-- There used to be a RoleNotifiesOwnerOnBooking here -- a query written specifically for "should the
-- owner be notified when a booking is confirmed". It had two problems: one, the roles table
-- shouldn't know what a booking is (that switch is now declared by calendar.book itself on the role
-- scope in capconfig); two, it had **zero callers** -- that repo method was never called, the one
-- actually in use has always been the copy frozen into the role snapshot.

-- name: DeleteRole :exec
DELETE FROM roles WHERE id = $1 AND owner_id = $2 AND is_builtin = false;

-- name: ClearRoleCorpusURIs :exec
DELETE FROM role_corpus_uris WHERE role_id = $1;

-- name: AttachRoleCorpusURIs :exec
-- Bulk insert from text[]. Caller has already run ClearRoleCorpusURIs.
INSERT INTO role_corpus_uris (role_id, uri_pattern)
SELECT $1, unnest($2::text[])
ON CONFLICT DO NOTHING;

-- name: ListRoleCorpusURIs :many
SELECT uri_pattern FROM role_corpus_uris WHERE role_id = $1 ORDER BY uri_pattern ASC;

-- name: ClearRoleWaypoints :exec
DELETE FROM role_waypoints WHERE role_id = $1;

-- name: AttachRoleWaypoint :exec
-- Insert one at a time (few waypoints + evidence_refs is per-row jsonb, so no unnest bulk insert).
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
-- The "N active codes" metric on the /admin/roles card.
SELECT COUNT(*)::bigint FROM access_codes
WHERE assumed_role_id = $1 AND status = 'active';
