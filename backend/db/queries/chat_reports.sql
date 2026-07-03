-- name: UpsertChatReport :one
-- #129 一会话一份:conversation 已有 report → 改写 html(revise)，返回同一行(report_id 稳定)。
INSERT INTO chat_reports (owner_id, conversation_id, html)
VALUES ($1, $2, $3)
ON CONFLICT (conversation_id) DO UPDATE SET html = EXCLUDED.html
RETURNING *;

-- name: GetChatReport :one
SELECT * FROM chat_reports WHERE id = $1;
