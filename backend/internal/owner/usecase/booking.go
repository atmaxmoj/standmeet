// booking.go —— the booking events this domain records for the booking block, and the owner's
// "new booking" notice (docs/design/event-bus-outbox-webhooks.md, *Phase 4*). A booking lives in
// the block's own store; the block tells the host through the booking.record host op, which
// records the event — and the notice, when the role asked for one — before it answers. The mail
// is the owner.notify job's to send.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// Booking event types. Thin: the subject is booking/<id>, the data is {booking_id}.
const (
	BookingCreated     = "booking.created"
	BookingCancelled   = "booking.cancelled"
	BookingRescheduled = "booking.rescheduled"
)

// ErrBadBookingRecord —— a booking record the host cannot take: an unknown event, no booking id,
// or a notice on anything but a new booking.
var ErrBadBookingRecord = errors.New("bad booking record")

// BookingRecord —— one booking event, and for a new booking the owner's notice (nil = the role did
// not ask for one).
type BookingRecord struct {
	Notice    *repo.BookingNotice
	OwnerID   string
	Type      string // one of the Booking* event types
	BookingID string
}

// BookingEventTypes —— the booking event types, declared here: no host domain stores bookings,
// and this one acts on them (owner.notify).
func BookingEventTypes() []events.Type {
	t := func(typ, what string) events.Type {
		return events.Type{
			Type: typ, Description: what + " (data.booking_id).",
			Subject: "booking/<booking id>", Exposure: events.Webhook,
		}
	}
	return []events.Type{
		t(BookingCreated, "A visitor booked a meeting"),
		t(BookingCancelled, "A booking was cancelled"),
		t(BookingRescheduled, "A booking was moved to a new booking"),
	}
}

// BookingRecorder —— records booking events into the outbox.
type BookingRecorder struct {
	Owners *repo.Repo
	Events events.Recorder
}

// RecordBooking —— the event, and a new booking's notice, in one transaction: when it returns nil
// both are committed.
func (b BookingRecorder) RecordBooking(ctx context.Context, in *BookingRecord) error {
	if !validBookingRecord(in) {
		return fmt.Errorf("%w: %s %q", ErrBadBookingRecord, in.Type, in.BookingID)
	}
	data := map[string]string{"booking_id": in.BookingID}
	//nolint:wrapcheck // the repo and Record name their steps
	return b.Owners.RecordBooking(ctx, in.Notice, func(tx pgstore.Tx) error {
		return b.Events.With(tx).Record(ctx, in.OwnerID, in.Type, "booking/"+in.BookingID, data)
	})
}

func validBookingRecord(in *BookingRecord) bool {
	types := []string{BookingCreated, BookingCancelled, BookingRescheduled}
	return in.BookingID != "" && slices.Contains(types, in.Type) &&
		(in.Notice == nil || in.Type == BookingCreated)
}

// NewBookingNotice —— tells the owner someone booked: what, with whom, and when in the owner's
// zone (UTC when the owner set none, or one this build cannot read).
func NewBookingNotice(n *repo.BookingNotice, ownerEmail, ownerTZ string) OutboundNotice {
	zone, err := time.LoadLocation(ownerTZ)
	if err != nil {
		zone = time.UTC
	}
	who := n.VisitorName
	if who == "" {
		who = "A visitor"
	}
	when := n.StartAt.In(zone).Format("Monday, Jan 2, 2006 · 3:04 PM MST")
	return OutboundNotice{
		To:    ownerEmail,
		Title: "New booking: " + n.Summary,
		Body: "New booking on your calendar:\n\n  " + n.Summary + "\n  with " + who +
			"\n  " + when + "\n",
	}
}
