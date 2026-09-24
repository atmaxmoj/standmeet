-- public_conversation_policy —— how the owner keeps codeless (public / byoai) conversations.

-- name: GetPublicConversationPolicy :one
SELECT save, prune_cron, retention_days, last_run_at
FROM public_conversation_policy WHERE owner_id = $1;

-- Changing the policy restarts the prune clock: the next run is the first tick after now.
-- name: UpsertPublicConversationPolicy :one
INSERT INTO public_conversation_policy (owner_id, save, prune_cron, retention_days)
VALUES ($1, $2, $3, $4)
ON CONFLICT (owner_id) DO UPDATE SET
    save           = EXCLUDED.save,
    prune_cron     = EXCLUDED.prune_cron,
    retention_days = EXCLUDED.retention_days,
    last_run_at    = now()
RETURNING save, prune_cron, retention_days, last_run_at;

-- Whether a turn on this conversation may be written: coded always; codeless unless the owner
-- turned saving off. Codeless = mode <> 'code' (not code_id IS NULL: deleting a code sets its
-- conversations' code_id to NULL, and those are still coded).
-- name: ConversationSavesMessages :one
SELECT c.mode = 'code' OR COALESCE(p.save, true)
FROM conversations c
LEFT JOIN public_conversation_policy p ON p.owner_id = c.owner_id
WHERE c.id = $1;

-- name: ListScheduledPublicPrunes :many
SELECT owner_id, prune_cron, retention_days, last_run_at
FROM public_conversation_policy WHERE prune_cron <> '';

-- name: PruneCodelessConversations :execrows
DELETE FROM conversations
WHERE owner_id = $1
  AND mode <> 'code'
  AND last_at < now() - make_interval(days => sqlc.arg(retention_days)::int);

-- name: MarkPublicPruneRun :exec
UPDATE public_conversation_policy SET last_run_at = now() WHERE owner_id = $1;
