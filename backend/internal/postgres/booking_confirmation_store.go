// booking_confirmation_store.go —— #122/#6 confirmation-claim persistence. Split from
// calendar_bookings.go to keep it under the file-length limit.

package postgres

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// MarkBookingConfirmed —— CLAIM this booking's confirmation atomically. Affects 0 rows if it was
// already claimed → ErrBookingAlreadyConfirmed (caller must not send). The claim runs BEFORE the
// email so two concurrent requests can't both send.
func (r *CalendarRepo) MarkBookingConfirmed(ctx context.Context, bookingID string) error {
	bookingUUID, err := parseUUID(bookingID)
	if err != nil {
		return fmt.Errorf("parse booking id: %w", err)
	}
	rows, qerr := dbq.New(r.pool).MarkBookingConfirmationSent(ctx, bookingUUID)
	if qerr != nil {
		return fmt.Errorf("mark booking confirmed: %w", qerr)
	}
	if rows == 0 {
		return domain.ErrBookingAlreadyConfirmed
	}
	return nil
}

// ClearBookingConfirmed —— release a confirmation claim when the send FAILED after claiming, so a
// retry can re-claim and send (no email went out).
func (r *CalendarRepo) ClearBookingConfirmed(ctx context.Context, bookingID string) error {
	bookingUUID, err := parseUUID(bookingID)
	if err != nil {
		return fmt.Errorf("parse booking id: %w", err)
	}
	if qerr := dbq.New(r.pool).ClearBookingConfirmationSent(ctx, bookingUUID); qerr != nil {
		return fmt.Errorf("clear booking confirmed: %w", qerr)
	}
	return nil
}
