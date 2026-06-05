-- name: CreateChatReport :one
INSERT INTO chat_reports (owner_id, conversation_id, html)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetChatReport :one
SELECT * FROM chat_reports WHERE id = $1;

-- name: ListChatReportsByConversation :many
SELECT * FROM chat_reports
WHERE conversation_id = $1 AND owner_id = $2
ORDER BY created_at DESC;
