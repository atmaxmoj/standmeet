// calendar_book_repro_test.go —— RED repro for confirmed booking defects found in the systematic
// bug hunt. These tests demonstrate the WRONG behavior against current code (they fail); the fix
// lands separately. Pure-logic, fake proxy + store, no DB / no calendar / no stack.

package usecases

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// fakeBookProxy —— records InsertEvent / DeleteEvent so a repro can assert compensation.
type fakeBookProxy struct {
	inserted    InsertedEvent
	insertErr   error
	busy        []BusyInterval
	deleteCalls []string
	connected   bool
}

func (f *fakeBookProxy) Connected(context.Context, string) (bool, error) { return f.connected, nil }

func (f *fakeBookProxy) FreeBusy(context.Context, string, FreeBusyReq) ([]BusyInterval, error) {
	return f.busy, nil
}

func (f *fakeBookProxy) InsertEvent(
	context.Context, string, *InsertEventReq,
) (InsertedEvent, error) {
	return f.inserted, f.insertErr
}

func (f *fakeBookProxy) DeleteEvent(_ context.Context, _, eventID, _ string) error {
	f.deleteCalls = append(f.deleteCalls, eventID)
	return nil
}

// fakeBookStore —— configurable policy + failable CreateBooking; count reflects persisted rows.
type fakeBookStore struct {
	createErr error
	policy    domain.BookingPolicy
	count     int32
}

func (f *fakeBookStore) GetBookingPolicy(context.Context, string) (domain.BookingPolicy, error) {
	return f.policy, nil
}

func (f *fakeBookStore) CreateBooking(
	context.Context, *CreateBookingInput,
) (domain.CodeBooking, error) {
	if f.createErr != nil {
		return domain.CodeBooking{}, f.createErr
	}
	f.count++
	return domain.CodeBooking{ID: "bk-1"}, nil
}

func (f *fakeBookStore) CountBookingsForCode(context.Context, string) (int32, error) {
	return f.count, nil
}

// permissivePolicy —— any future slot passes lead / weekday / hours.
func permissivePolicy() domain.BookingPolicy {
	return domain.BookingPolicy{
		OwnerID:           tcOwner,
		WorkingHoursStart: "00:00",
		WorkingHoursEnd:   "23:59",
		AllowedWeekdays:   []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"},
	}
}

const (
	reproSlotHour    = 10 // 10:00 local — comfortably inside 00:00–23:59 working hours
	reproDurationMin = 30
	reproLeadDays    = 3 // well past any MinLeadDays
)

// futureSlot —— a fixed 10:00 UTC slot a few days out (well past lead time, inside hours).
func futureSlot() time.Time {
	d := time.Now().UTC().AddDate(0, 0, reproLeadDays)
	return time.Date(d.Year(), d.Month(), d.Day(), reproSlotHour, 0, 0, 0, time.UTC)
}

func bookInput(slot time.Time) *BookMeetingInput {
	return &BookMeetingInput{
		OwnerID: tcOwner, CodeID: tcCode, ConversationID: tcConv,
		VisitorName: "V", Topic: "chat", VisitorEmail: "v@example.com",
		PreferredTimes: []time.Time{slot}, DurationMin: reproDurationMin,
	}
}

// TestBookMeetingOrphansEventOnPersistFailure —— RED repro (#3): InsertEvent creates a real
// calendar event, then persistBooking fails; BookMeeting returns the error but never deletes the
// event it just created → an orphaned event on the owner's calendar with no booking row (no
// confirmation, no cancel handle). Compensation (DeleteEvent) must run on persist failure.
func TestBookMeetingOrphansEventOnPersistFailure(t *testing.T) {
	t.Parallel()
	proxy := &fakeBookProxy{
		connected: true,
		inserted:  InsertedEvent{EventID: "evt-1", HTMLLink: "https://cal/evt-1"},
	}
	store := &fakeBookStore{policy: permissivePolicy(), createErr: errors.New("db down")}
	_, err := BookMeeting(context.Background(), proxy, store, bookInput(futureSlot()))
	require.Error(t, err)
	require.Equal(t, []string{"evt-1"}, proxy.deleteCalls,
		"orphaned event must be deleted when the booking row fails to persist")
}
