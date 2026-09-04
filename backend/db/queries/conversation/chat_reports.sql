-- name: UpsertChatReport :one
-- #129 one per conversation: if the conversation already has a report → rewrite html (revise), returning the same row (report_id stable).
INSERT INTO chat_reports (owner_id, conversation_id, html)
VALUES ($1, $2, $3)
ON CONFLICT (conversation_id) DO UPDATE SET html = EXCLUDED.html
RETURNING *;

-- name: GetChatReport :one
SELECT * FROM chat_reports WHERE id = $1;
