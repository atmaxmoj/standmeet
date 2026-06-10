-- name: RecordShownGhost :one
INSERT INTO conversation_ghosts (
    owner_id, conversation_id, turn_index, ghost_text, source
)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: MarkGhostAccepted :one
UPDATE conversation_ghosts
SET accepted_at = now()
WHERE id = $1 AND conversation_id = $2 AND owner_id = $3
RETURNING *;

-- name: ListGhostsByConversation :many
SELECT * FROM conversation_ghosts
WHERE conversation_id = $1 AND owner_id = $2
ORDER BY shown_at ASC;
