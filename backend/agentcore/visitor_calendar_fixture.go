// visitor_calendar_fixture.go —— F.2.2b: canned calendar backings so the eval
// facade can expose the REAL booking capability (calendar_book + list_slots).
// The booker assembles BookMeeting/ListAvailableSlots over the CalendarStore +
// CalendarClient interfaces (already fake-friendly in prod) and an OwnerGetter;
// these fixtures stand in for Google Calendar + the connector/policy/booking
// repos so the agent's USE of booking runs end-to-end without a DB or OAuth.
//
// Default behaviour is "connected, wide-open policy, every slot free, insert
// succeeds" so a proposed time books deterministically. bookingFailure injects
// the interesting failure paths (the eval's old EVAL_TOOLS_FAIL, now at the
// right layer — the data source, not a canned tool) to audit how the agent
// explains them.

package agentcore

import (
	"context"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/gcal"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// ownerFixture —— OwnerGetter returning one eval owner. ProfileTimezone feeds
// the booking-policy timezone math; FirstHandle/GetByHandle back the public-tier
// sole-owner lookup (unused in code mode but part of the port).
type ownerFixture struct {
	ownerID string
	tz      string
}

func (f ownerFixture) GetByID(_ context.Context, id string) (domain.Owner, error) {
	return domain.Owner{ID: id, Handle: f.ownerID, ProfileTimezone: f.tz}, nil
}

func (f ownerFixture) FirstHandle(_ context.Context) (string, error) {
	return f.ownerID, nil
}

func (f ownerFixture) GetByHandle(_ context.Context, handle string) (domain.Owner, error) {
	return domain.Owner{ID: f.ownerID, Handle: handle, ProfileTimezone: f.tz}, nil
}

// cannedCalendarStore —— CalendarStore fixture: a connected connector with a
// fresh token (so the refresh path is skipped), a wide-open booking policy (any
// future time passes), zero existing bookings, and a no-op persist.
type cannedCalendarStore struct {
	failure string
}

func (s cannedCalendarStore) GetConnector(
	_ context.Context, ownerID, provider string,
) (domain.CalendarConnector, error) {
	if s.failure == "notconnected" {
		return domain.CalendarConnector{OwnerID: ownerID, Provider: provider}, nil
	}
	exp := time.Now().Add(2 * time.Hour) // not stale → ensureFreshToken skips refresh
	now := time.Now()
	return domain.CalendarConnector{
		OwnerID: ownerID, Provider: provider,
		ClientID: "eval", ClientSecret: "eval",
		AccessToken: "eval-access-token", RefreshToken: "eval-refresh-token",
		AccessTokenExpiresAt: &exp, ConnectedAt: &now,
		Scopes: []string{"https://www.googleapis.com/auth/calendar"},
	}, nil
}

func (cannedCalendarStore) SaveTokens(_ context.Context, _ *usecases.SaveTokensInput) error {
	return nil
}

func (cannedCalendarStore) GetBookingPolicy(
	_ context.Context, ownerID string,
) (domain.BookingPolicy, error) {
	return domain.BookingPolicy{
		OwnerID:           ownerID,
		WorkingHoursStart: "00:00",
		WorkingHoursEnd:   "23:59",
		AllowedWeekdays:   []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"},
		MinLeadHours:      0,
		BufferMin:         0,
	}, nil
}

func (cannedCalendarStore) CreateBooking(
	_ context.Context, in *usecases.CreateBookingInput,
) (domain.CodeBooking, error) {
	return domain.CodeBooking{
		ID: "eval-booking", OwnerID: in.OwnerID, CodeID: in.CodeID,
		ConversationID: in.ConversationID, GoogleEventID: in.GoogleEventID,
		Summary: in.Summary, StartAt: in.StartAt, EndAt: in.EndAt,
		VisitorEmail: in.VisitorEmail,
	}, nil
}

func (cannedCalendarStore) CountBookingsForCode(_ context.Context, _ string) (int32, error) {
	return 0, nil
}

// cannedCalendarClient —— CalendarClient fixture: FreeBusy reports everything
// free (so any policy-passing slot is bookable), InsertEvent succeeds with a
// canned event. bookingFailure="conflict" makes every proposed slot busy, so the
// agent hits the all-busy path and has to explain it.
type cannedCalendarClient struct {
	failure string
}

func (c cannedCalendarClient) FreeBusy(
	_ context.Context, in *gcal.FreeBusyInput,
) ([]gcal.BusyWindow, error) {
	if c.failure == "conflict" {
		// Mark the entire queried span busy → no free slot found.
		return []gcal.BusyWindow{{Start: in.TimeMin, End: in.TimeMax}}, nil
	}
	return nil, nil
}

func (cannedCalendarClient) InsertEvent(
	_ context.Context, _ *gcal.InsertEventInput,
) (gcal.InsertedEvent, error) {
	return gcal.InsertedEvent{
		EventID:  "evt_eval_canned",
		HTMLLink: "https://calendar.google.com/event?eid=evt_eval_canned",
		Status:   "confirmed",
	}, nil
}

func (cannedCalendarClient) RefreshToken(
	_ context.Context, _ gcal.RefreshTokenInput,
) (gcal.TokenResponse, error) {
	return gcal.TokenResponse{
		AccessToken: "eval-access-token",
		ExpiresAt:   time.Now().Add(time.Hour),
	}, nil
}
