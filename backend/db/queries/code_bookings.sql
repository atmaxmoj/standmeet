-- name: CreateCodeBooking :one
INSERT INTO code_bookings (
    owner_id, code_id, conversation_id,
    google_event_id, google_html_link, summary,
    start_at, end_at, visitor_email
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListCodeBookingsByOwner :many
SELECT * FROM code_bookings
WHERE owner_id = $1
ORDER BY created_at DESC
LIMIT $2;

-- name: GetLatestBookingByConversation :one
-- 某对话最近一笔预约(#122 发确认信:前端不传 id,后端按 session→对话定位)。
SELECT * FROM code_bookings
WHERE conversation_id = $1
ORDER BY created_at DESC
LIMIT 1;

-- name: GetBookingForMemberByEvent :one
-- #123 访客取消的隔离门:用 google_event_id 找 booking,但只在它属于本 session
-- (owner + code 都对,且其 conversation 归属同一个 member)时才返。任一不匹 → 0 行
-- → caller 翻 ErrBookingNotFound(不泄露存在性)。同码跨 member / 跨 code 都被挡。
SELECT b.* FROM code_bookings b
JOIN conversations c ON c.id = b.conversation_id
WHERE b.google_event_id = $1
  AND b.owner_id = $2
  AND b.code_id = $3
  AND c.member_id = $4;

-- name: MarkBookingConfirmationSent :exec
-- 标记这笔已发过确认信(幂等:已发再发 → 0 行,caller 翻 ErrConfirmationAlreadySent)。
UPDATE code_bookings
SET confirmation_sent_at = now()
WHERE id = $1 AND confirmation_sent_at IS NULL;
