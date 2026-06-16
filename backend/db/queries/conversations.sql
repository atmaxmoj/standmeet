-- name: CreateConversation :one
INSERT INTO conversations (
    owner_id, mode, code_id, member_id, visitor_name, client_ip, doc_key
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetConversation :one
SELECT * FROM conversations WHERE id = $1 AND owner_id = $2;

-- name: GetOpenConversationByMember :one
-- 「一个名字=一段续聊的会」(主对话):同名 member 的**主**对话(doc_key='')续上;
-- 没有 → caller 新建。对话不结束,同名永远续同一段主对话。
SELECT * FROM conversations
WHERE member_id = $1 AND doc_key = ''
ORDER BY last_at DESC
LIMIT 1;

-- name: GetOpenConversationByMemberAndDoc :one
-- 浮窗用:该 member 在某个 surface(doc_key)上的那段对话。没有 → caller 新建。
SELECT * FROM conversations
WHERE member_id = $1 AND doc_key = $2
ORDER BY last_at DESC
LIMIT 1;

-- name: CountVisitorTurnsForMember :one
-- member 级 turn 配额:该 member 名下**全部对话**的访客发言合计。多段对话共享
-- 一个预算,不按单段对话各算。
SELECT COUNT(*)::int FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE c.member_id = $1 AND m.role = 'visitor';

-- name: ListMemberOtherConversationMessages :many
-- 「互通」:拉该 member **其他**对话(排除当前这段)的近期消息,拼进 instruction
-- 让 AI 跨对话连贯。按时间正序,caller 自己截断/汇总。
SELECT c.doc_key, c.started_at, m.role, m.body, m.created_at
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE c.member_id = $1 AND c.id <> $2
ORDER BY m.created_at;

-- name: AppendMessage :one
INSERT INTO messages (
    conversation_id, role, body, tool_calls, cited_wiki_ids, cited_output_ids
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListMessages :many
SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at;

-- name: BumpConversation :exec
-- 只更 last_at(给列表排序);turn 数不再存,读时从 messages 派生。
UPDATE conversations
SET last_at = now()
WHERE id = $1;

-- name: ListConversationsByOwner :many
-- turn_count 从 dialog 派生:数 visitor-role messages(一个 dialog 一条 visitor 消息),
-- 不存计数字段。
SELECT c.id, c.mode, c.code_id, c.visitor_name, c.started_at,
       c.last_at, c.client_ip,
       (SELECT COUNT(*) FROM messages m
        WHERE m.conversation_id = c.id AND m.role = 'visitor')::int AS turn_count,
       ac.label AS code_label, ac.code AS code_value
FROM conversations c
LEFT JOIN access_codes ac ON ac.id = c.code_id
WHERE c.owner_id = $1
ORDER BY c.last_at DESC
LIMIT $2;

