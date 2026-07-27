-- role_reads.sql —— role↔skill / role↔mcp 的 JOIN 读:返回 marketplace 的 Skill /
-- McpServer 行(按 role 过滤)。这两条读属 marketplace(返回它的模型),不进 access 的
-- 生成包,以免 access DAO 里混入跨域模型。写侧 + id-only 读仍在 access/roles.sql。

-- name: ListRoleSkills :many
-- session issue 时拿 skills 拼 system prompt。enabled=false 的 skill 被 owner
-- 全局停用,即使挂在 role 上也不进 agent(#48-2)。
SELECT s.* FROM skills s
JOIN role_skills rs ON rs.skill_id = s.id
WHERE rs.role_id = $1 AND s.enabled
ORDER BY s.name ASC;

-- name: ListRoleMCPServers :many
-- session issue 时拿 MCP servers 拼 ext-server tool 列表。
SELECT m.* FROM mcp_servers m
JOIN role_mcp_servers rms ON rms.mcp_server_id = m.id
WHERE rms.role_id = $1
ORDER BY m.name ASC;

