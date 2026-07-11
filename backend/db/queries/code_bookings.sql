-- name: CreateCodeBooking :one
-- Atomic quota enforcement: FOR UPDATE locks the code row so concurrent bookings for the same code
-- serialize; the insert only happens if the current count is under the code's max_bookings cap
-- (NULL = unlimited). Over cap → 0 rows → caller maps to a quota error. This is the authoritative
-- gate; the assembly-time check is only an advisory hide and is bypassable (concurrent / within-turn
-- book calls) without this.
WITH cap AS (
    SELECT max_bookings FROM access_codes WHERE id = $2 FOR UPDATE
)
INSERT INTO code_bookings (
    owner_id, code_id, conversation_id,
    google_event_id, google_html_link, summary,
    start_at, end_at, visitor_email
)
SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
FROM cap
WHERE (SELECT COUNT(*) FROM code_bookings WHERE code_id = $2)
      < COALESCE(cap.max_bookings, 2147483647)
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

-- name: MarkBookingConfirmationSent :execrows
-- CLAIM this booking's confirmation atomically (idempotent + race-safe): sets sent_at only if still
-- NULL and returns rows-affected. 0 rows = someone already claimed it → caller must NOT send. The
-- claim happens BEFORE the email is sent so two concurrent requests can't both send (TOCTOU).
UPDATE code_bookings
SET confirmation_sent_at = now()
WHERE id = $1 AND confirmation_sent_at IS NULL;

-- name: ClearBookingConfirmationSent :exec
-- Release a confirmation claim (set back to NULL) when the send FAILED after claiming, so a retry
-- can re-claim and send. Only clears our own just-set claim path.
UPDATE code_bookings
SET confirmation_sent_at = NULL
WHERE id = $1;
