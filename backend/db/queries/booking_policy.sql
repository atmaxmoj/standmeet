-- name: UpsertBookingPolicy :one
INSERT INTO owner_booking_policy (
    owner_id, min_lead_hours, allowed_weekdays,
    working_hours_start, working_hours_end, buffer_min
)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (owner_id) DO UPDATE
SET min_lead_hours = EXCLUDED.min_lead_hours,
    allowed_weekdays = EXCLUDED.allowed_weekdays,
    working_hours_start = EXCLUDED.working_hours_start,
    working_hours_end = EXCLUDED.working_hours_end,
    buffer_min = EXCLUDED.buffer_min,
    updated_at = now()
RETURNING *;

-- name: GetBookingPolicy :one
SELECT * FROM owner_booking_policy WHERE owner_id = $1;
