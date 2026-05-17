-- name: CreateConversation :one
INSERT INTO conversations (owner_id, tier, code_id, member_id, visitor_name, byoai_provider)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetConversation :one
SELECT * FROM conversations WHERE id = $1 AND owner_id = $2;

-- name: AppendMessage :one
INSERT INTO messages (conversation_id, role, body, tool_calls, cited_wiki_ids)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListMessages :many
SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at;

-- name: BumpConversation :exec
UPDATE conversations
SET last_at = now(),
    message_count = message_count + 1,
    hit_private = hit_private OR $2
WHERE id = $1;
