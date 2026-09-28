-- name: CreateConversation :one
INSERT INTO conversations (
    owner_id, mode, code_id, member_id, visitor_name, client_ip, doc_key
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetConversation :one
SELECT * FROM conversations WHERE id = $1 AND owner_id = $2;

-- name: GetOpenConversationByMember :one
-- "one name = one continuing session" (main conversation): resume the same-name member's **main** conversation (doc_key='');
-- none → caller creates one. Conversations never end, so the same name always resumes the same main conversation.
SELECT * FROM conversations
WHERE member_id = $1 AND doc_key = ''
ORDER BY last_at DESC
LIMIT 1;

-- name: GetOpenConversationByMemberAndDoc :one
-- For the floating widget: the member's conversation on a given surface (doc_key). none → caller creates one.
SELECT * FROM conversations
WHERE member_id = $1 AND doc_key = $2
ORDER BY last_at DESC
LIMIT 1;

-- name: CountVisitorTurnsForMember :one
-- member-level turn quota: total visitor turns across **all conversations** under this member. Multiple
-- conversations share one budget, not counted per conversation.
SELECT COUNT(*)::int FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE c.member_id = $1 AND m.role = 'visitor';

-- name: ListMemberOtherConversationMessages :many
-- "cross-talk": pull recent messages from the member's **other** conversations (excluding the current one) to
-- splice into the instruction so the AI stays coherent across conversations. Time ascending; the caller truncates/summarizes.
SELECT c.doc_key, c.started_at, m.role, m.body, m.created_at
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE c.member_id = $1 AND c.id <> $2
ORDER BY m.created_at, CASE m.role WHEN 'visitor' THEN 0 ELSE 1 END; -- same tie rule as ListMessages

-- name: CreateDialog :one
-- One Q-A round first creates a dialog row; the two messages hang off its id. Returns the real dialog id.
INSERT INTO dialogs (conversation_id)
VALUES ($1)
RETURNING id;

-- name: AppendMessage :one
-- grounded_subjectivity_ids is a separate column from cited_: the visitor footer reads only cited_, so private
-- standpoint notes are **structurally** unable to leak in, rather than relying on every reader remembering to filter (F-A-27).
INSERT INTO messages (
    conversation_id, dialog_id, role, body, tool_calls,
    cited_wiki_ids, cited_output_ids, cited_subjectivity_ids, cited_writing_ids,
    grounded_subjectivity_ids
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: ListMessages :many
-- A turn's visitor and assistant rows are written in one transaction, so created_at (now() = the
-- transaction's start) is the SAME for both: the time alone cannot order them, and the tie came
-- back answer-first on a live table (owner transcript, 2026-09-28). Within a moment, the question
-- comes first. ListMemberOtherConversationMessages below orders by the same rule.
SELECT * FROM messages WHERE conversation_id = $1
ORDER BY created_at, CASE role WHEN 'visitor' THEN 0 ELSE 1 END;

-- name: BumpConversation :exec
-- Only update last_at (for list ordering); turn count is no longer stored, derived from messages at read time.
UPDATE conversations
SET last_at = now()
WHERE id = $1;

-- name: ListConversationsPage :many
-- One page of the owner's conversations, most recent activity first (docs/design/paging.md).
-- turn_count is derived from dialogs: count visitor-role messages (one visitor message per dialog),
-- no stored count field. code: empty = every conversation, else only those on that code string
-- (case-insensitive). total: how many conversations match the filter on every page — an
-- uncorrelated subquery (evaluated once), not COUNT(*) OVER (), which would also apply the
-- cursor and count only what is left.
SELECT c.id, c.mode, c.code_id, c.visitor_name, c.started_at,
       c.last_at, c.client_ip,
       (SELECT COUNT(*) FROM messages m
        WHERE m.conversation_id = c.id AND m.role = 'visitor')::int AS turn_count,
       ac.label AS code_label, ac.code AS code_value,
       (SELECT COUNT(*) FROM conversations c2
        LEFT JOIN access_codes ac2 ON ac2.id = c2.code_id
        WHERE c2.owner_id = sqlc.arg('owner_id')
          AND (sqlc.arg('code')::text = '' OR lower(ac2.code) = lower(sqlc.arg('code'))))::int AS total
FROM conversations c
LEFT JOIN access_codes ac ON ac.id = c.code_id
WHERE c.owner_id = sqlc.arg('owner_id')
  AND (sqlc.arg('code')::text = '' OR lower(ac.code) = lower(sqlc.arg('code')))
  AND (sqlc.narg('after_at')::timestamptz IS NULL
    OR (c.last_at, c.id) < (sqlc.narg('after_at'), sqlc.narg('after_id')::uuid))
ORDER BY c.last_at DESC, c.id DESC
LIMIT sqlc.arg('lim');


-- name: CountSessionsForMember :one
SELECT COUNT(*)::int FROM conversations WHERE member_id = $1;

-- name: CountVisitorTurnsInConversation :one
SELECT COUNT(*)::int FROM messages WHERE conversation_id = $1 AND role = 'visitor';

