-- role_reads.sql —— role↔skill / role↔mcp JOIN reads: return marketplace Skill / McpServer rows (filtered by
-- role). These two reads belong to marketplace (they return its models), and are kept out of access's generated
-- package to avoid mixing cross-domain models into the access DAO. The write side + id-only reads stay in access/roles.sql.

-- name: ListRoleSkills :many
-- At session issue, fetch skills to assemble the system prompt. A skill with enabled=false is globally disabled by
-- the owner, so it does not enter the agent even when attached to the role (#48-2).
SELECT s.* FROM skills s
JOIN role_skills rs ON rs.skill_id = s.id
WHERE rs.role_id = $1 AND s.enabled
ORDER BY s.name ASC;

-- name: ListRoleMCPServers :many
-- At session issue, fetch MCP servers to assemble the ext-server tool list.
SELECT m.* FROM mcp_servers m
JOIN role_mcp_servers rms ON rms.mcp_server_id = m.id
WHERE rms.role_id = $1
ORDER BY m.name ASC;

