-- mcp_app_state —— MCP App 跨刷新状态。scope = (member, mcp_id)；mcp_id 由后端从
-- tool 派生。get 整格、upsert 一个 key、delete 一个 key。

-- name: UpsertAppState :exec
INSERT INTO mcp_app_state (owner_id, member_id, mcp_id, state_key, value)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (member_id, mcp_id, state_key) DO UPDATE SET
    value      = EXCLUDED.value,
    updated_at = now();

-- name: GetAppStateByMCP :many
SELECT state_key, value FROM mcp_app_state
WHERE member_id = $1 AND mcp_id = $2
ORDER BY state_key;

-- name: DeleteAppState :exec
DELETE FROM mcp_app_state
WHERE member_id = $1 AND mcp_id = $2 AND state_key = $3;
