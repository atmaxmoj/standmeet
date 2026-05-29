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
