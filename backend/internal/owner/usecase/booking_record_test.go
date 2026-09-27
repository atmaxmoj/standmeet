package usecase_test

// booking.record, against a real Postgres: the event exists if and only if the op answered ok, and
// a new booking's owner notice commits with it (docs/design/event-bus-outbox-webhooks.md,
// *Phase 4*).

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/owner/ops"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

type bookingFixture struct {
	pool  *pgxpool.Pool
	op    hostop.Op
	owner string
}

func bookingSetup(t *testing.T, types []events.Type) *bookingFixture {
	t.Helper()
	pool := scratchDB(t)
	var owner string
	if err := pool.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name) VALUES ('o@example.com', 'x', 'o', 'O')
		RETURNING id`).Scan(&owner); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	bus, err := events.New(pool, types, nil)
	if err != nil {
		t.Fatal(err)
	}
	rec := usecase.BookingRecorder{Owners: repo.NewRepo(pool), Events: bus.Recorder()}
	return &bookingFixture{pool: pool, op: ops.BookingHostOps(rec)[0], owner: owner}
}

func (f *bookingFixture) call(event, id, notice string) error {
	raw := `{"owner_id":"` + f.owner + `","event":"` + event + `","booking_id":"` + id + `"`
	if notice != "" {
		raw += `,"notice":` + notice
	}
	_, err := f.op.Invoke(context.Background(), json.RawMessage(raw+"}"))
	return err
}

// count —— rows matching q with the one argument arg.
func (f *bookingFixture) count(t *testing.T, q, arg string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), q, arg).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

const (
	eventsFor = `SELECT count(*) FROM events WHERE subject = $1`
	noticeFor = `SELECT count(*) FROM booking_notices WHERE booking_id = $1`
	aNotice   = `{"summary":"Dana — Intro","visitor_name":"Dana","start_at":"2030-03-04T14:00:00Z"}`
)

// TestBookingRecord_okMeansRecorded — an ok answer leaves exactly one thin event naming the
// booking, and the notice the block handed over.
func TestBookingRecord_okMeansRecorded(t *testing.T) {
	t.Parallel()
	f := bookingSetup(t, usecase.BookingEventTypes())
	if err := f.call("created", "bk-1", aNotice); err != nil {
		t.Fatal(err)
	}
	var data string
	if err := f.pool.QueryRow(context.Background(), `SELECT data::text FROM events
		WHERE type = 'booking.created' AND owner_id = $1 AND subject = 'booking/bk-1'`, f.owner,
	).Scan(&data); err != nil {
		t.Fatalf("want one booking.created for bk-1: %v", err)
	}
	if data != `{"booking_id": "bk-1"}` {
		t.Errorf("the event is thin: want only the booking id, got %s", data)
	}
	if n := f.count(t, noticeFor, "bk-1"); n != 1 {
		t.Errorf("want the owner notice stored with the event, got %d", n)
	}
}

// TestBookingRecord_laterChanges — a cancel and a reschedule are recorded on the same subject.
func TestBookingRecord_laterChanges(t *testing.T) {
	t.Parallel()
	f := bookingSetup(t, usecase.BookingEventTypes())
	for _, ev := range []string{"created", "rescheduled", "cancelled"} {
		if err := f.call(ev, "bk-4", ""); err != nil {
			t.Fatalf("%s: %v", ev, err)
		}
	}
	if n := f.count(t, eventsFor, "booking/bk-4"); n != 3 {
		t.Errorf("created, rescheduled, cancelled: want 3 events, got %d", n)
	}
}

// TestBookingRecord_errorMeansNothing — the event cannot be recorded (its type is undeclared): the
// op answers an error and neither the event nor the notice exists.
func TestBookingRecord_errorMeansNothing(t *testing.T) {
	t.Parallel()
	f := bookingSetup(t, []events.Type{})
	if err := f.call("created", "bk-2", aNotice); err == nil {
		t.Fatal("an unrecordable event must not answer ok")
	}
	if n := f.count(t, eventsFor, "booking/bk-2") + f.count(t, noticeFor, "bk-2"); n != 0 {
		t.Errorf("a failed record leaves nothing behind, got %d rows", n)
	}
}

// TestBookingRecord_refusesWhatIsNotABookingEvent — an unknown event, or a notice on anything but
// a new booking, is refused and records nothing.
func TestBookingRecord_refusesWhatIsNotABookingEvent(t *testing.T) {
	t.Parallel()
	f := bookingSetup(t, usecase.BookingEventTypes())
	if err := f.call("deleted", "bk-3", ""); err == nil {
		t.Error("booking.deleted is not a booking event")
	}
	if err := f.call("cancelled", "bk-3", aNotice); err == nil {
		t.Error("only a new booking carries an owner notice")
	}
	if n := f.count(t, eventsFor, "booking/bk-3"); n != 0 {
		t.Errorf("refused records leave no event, got %d", n)
	}
}
