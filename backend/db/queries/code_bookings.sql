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

-- name: MarkBookingConfirmationSent :exec
-- 标记这笔已发过确认信(幂等:已发再发 → 0 行,caller 翻 ErrConfirmationAlreadySent)。
UPDATE code_bookings
SET confirmation_sent_at = now()
WHERE id = $1 AND confirmation_sent_at IS NULL;
