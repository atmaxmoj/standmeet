package subscriber_test

// owner.notify on booking.created: the notice the booking block left with the event is mailed to
// the owner once (idempotency is covered by TestMailSubscriptions_idempotent).

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// noticeStart —— when the booked meeting starts: a Monday.
const noticeStart = "2030-03-04T14:00:00Z"

// bookingEvent —— a booking.created event as booking.record leaves it.
func bookingEvent(owner, id string) events.Event {
	return events.Event{
		ID: "ev-" + id, OwnerID: owner, Type: usecase.BookingCreated, Subject: "booking/" + id,
		Data: json.RawMessage(`{"booking_id":"` + id + `"}`),
	}
}

// notifiedBooking —— a booking whose role asked for the owner's notice: the event, and the notice
// booking.record stored with it.
func (f *mailFixture) notifiedBooking(t *testing.T, id string) events.Event {
	t.Helper()
	start, err := time.Parse(time.RFC3339, noticeStart)
	if err != nil {
		t.Fatal(err)
	}
	n := &repo.BookingNotice{
		OwnerID: f.owner, BookingID: id, Summary: "Dana — Intro call", VisitorName: "Dana",
		StartAt: start,
	}
	if err = f.deps.Owners.RecordBooking(context.Background(), n,
		func(pgstore.Tx) error { return nil }); err != nil {
		t.Fatal(err)
	}
	return bookingEvent(f.owner, id)
}

// TestOwnerNotify_booking — a booking whose role asked for a notice mails the owner what, with
// whom and when (the booking block's old wording); a retry after a failed send still sends it.
func TestOwnerNotify_booking(t *testing.T) {
	t.Parallel()
	f := mailSetup(t)
	sub := pick(t, f.deps, entity.OwnerNotify)
	ev := f.notifiedBooking(t, "bk-1")
	f.reg.err = transient
	retryable(t, sub.Handle(context.Background(), ev))
	f.reg.err = nil
	if err := sub.Handle(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
	f.sentCarries(t, ownerEmail, "New booking on your calendar:\n\n  Dana — Intro call\n"+
		"  with Dana\n  Monday, Mar 4, 2030 · 2:00 PM UTC\n")
	wellAddressed(t, f.reg.sent[0])
}

// TestOwnerNotify_bookingWithoutNotice — the role asked for no notice: the job ends, no mail.
func TestOwnerNotify_bookingWithoutNotice(t *testing.T) {
	t.Parallel()
	f := mailSetup(t)
	if err := pick(t, f.deps, entity.OwnerNotify).Handle(context.Background(),
		bookingEvent(f.owner, "bk-quiet")); err != nil {
		t.Fatal(err)
	}
	if len(f.reg.sent) != 0 {
		t.Errorf("no notice was asked for, got %d mails", len(f.reg.sent))
	}
}
