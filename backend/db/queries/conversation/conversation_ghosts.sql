-- name: RecordShownGhost :one
INSERT INTO conversation_ghosts (
    owner_id, conversation_id, turn_index, ghost_text, source
)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: RecordPolicyGhost :one
-- ghost-steering P3: a policy-emitted ghost, carrying a heading tag (target_waypoint) + coherence hook (follows_from).
INSERT INTO conversation_ghosts (
    owner_id, conversation_id, turn_index, ghost_text, source, target_waypoint, follows_from
)
VALUES ($1, $2, $3, $4, 'policy', $5, $6)
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

-- name: GhostWaypointTelemetry :many
-- ghost-steering telemetry: per-waypoint funnel (shown vs accepted) over the owner's policy ghosts.
-- accepted = accepted_at IS NOT NULL. Only source='policy' rows carry a target_waypoint.
SELECT
    target_waypoint,
    COUNT(*)::bigint            AS shown,
    COUNT(accepted_at)::bigint  AS accepted
FROM conversation_ghosts
WHERE owner_id = $1 AND source = 'policy' AND target_waypoint IS NOT NULL
GROUP BY target_waypoint
ORDER BY target_waypoint ASC;
