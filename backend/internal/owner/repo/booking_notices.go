// booking_notices.go —— the owner's "new booking" notices waiting for their mail. A row is written
// in the same transaction as the booking.created event and deleted once the mail went out (send,
// then delete): a second run of the same event finds nothing to send.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// BookingNotice —— what the owner's "new booking" mail says. It waits here until the owner.notify
// job sends it, and is gone once sent.
type BookingNotice struct {
	StartAt     time.Time
	OwnerID     string
	BookingID   string
	Summary     string
	VisitorName string
}

// RecordBooking —— runs record (the event) and stores the notice, if any, in one transaction: the
// notice exists if and only if its event does.
func (r *Repo) RecordBooking(
	ctx context.Context, n *BookingNotice, record func(tx pgstore.Tx) error,
) error {
	return pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		if err := record(tx); err != nil {
			return err
		}
		return insertBookingNotice(ctx, tx, n)
	})
}

// insertBookingNotice —— stores n; nil = no notice.
func insertBookingNotice(ctx context.Context, tx pgstore.Tx, n *BookingNotice) error {
	if n == nil {
		return nil
	}
	owner, err := pgstore.ParseUUID(n.OwnerID)
	if err != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO booking_notices
		(owner_id, booking_id, summary, visitor_name, start_at) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (owner_id, booking_id) DO NOTHING`,
		owner, n.BookingID, n.Summary, n.VisitorName, n.StartAt); err != nil {
		return fmt.Errorf("store booking notice: %w", err)
	}
	return nil
}

// BookingNotice —— the notice still waiting for this booking; nil when there is none (the role
// asked for no notice, or it was already sent).
func (r *Repo) BookingNotice(
	ctx context.Context, ownerID, bookingID string,
) (*BookingNotice, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	n := BookingNotice{OwnerID: ownerID, BookingID: bookingID}
	err = r.pool.QueryRow(ctx, `SELECT summary, visitor_name, start_at FROM booking_notices
		WHERE owner_id = $1 AND booking_id = $2`, owner, bookingID,
	).Scan(&n.Summary, &n.VisitorName, &n.StartAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read booking notice: %w", err)
	}
	return &n, nil
}

// DeleteBookingNotice —— the notice went out, or never can.
func (r *Repo) DeleteBookingNotice(ctx context.Context, ownerID, bookingID string) error {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	if _, err = r.pool.Exec(ctx, `DELETE FROM booking_notices
		WHERE owner_id = $1 AND booking_id = $2`, owner, bookingID); err != nil {
		return fmt.Errorf("delete booking notice: %w", err)
	}
	return nil
}
