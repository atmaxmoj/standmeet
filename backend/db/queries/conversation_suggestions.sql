-- name: RecordShownSuggestion :one
INSERT INTO conversation_suggestions (
    owner_id, conversation_id, turn_index, ghost_text, source
)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: MarkSuggestionAccepted :one
UPDATE conversation_suggestions
SET accepted_at = now()
WHERE id = $1 AND conversation_id = $2 AND owner_id = $3
RETURNING *;

-- name: ListSuggestionsByConversation :many
SELECT * FROM conversation_suggestions
WHERE conversation_id = $1 AND owner_id = $2
ORDER BY shown_at ASC;
