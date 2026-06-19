// visitor_calendar_fixture.go —— F.2.2b: canned calendar backings so the eval
// facade can expose the REAL booking capability (calendar_book + list_slots).
// Phase B: booking assembles over usecases.CalendarProxy (connector 代调) +
// the narrowed CalendarStore (booking policy/rows) + an OwnerGetter; these
// fixtures stand in for the connector + policy/booking repos so the agent's
// USE of booking runs end-to-end without a DB, OAuth, or Google.
//
// Default behaviour is "connected, wide-open policy, every slot free, insert
// succeeds" so a proposed time books deterministically. bookingFailure injects
// the interesting failure paths (notconnected / conflict) to audit how the
// agent explains them.

package agentcore

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/domain"
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

// cannedCalendarStore —— CalendarStore fixture: wide-open booking policy (any
// future time passes), zero existing bookings, no-op persist。连接器/凭据走
// cannedCalendarProxy，不在这里。
type cannedCalendarStore struct {
	failure string
}

func (cannedCalendarStore) GetBookingPolicy(
	_ context.Context, ownerID string,
) (domain.BookingPolicy, error) {
	return domain.BookingPolicy{
		OwnerID:           ownerID,
		WorkingHoursStart: "00:00",
		WorkingHoursEnd:   "23:59",
		AllowedWeekdays:   []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"},
		MinLeadDays:       0,
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

// cannedCalendarProxy —— usecases.CalendarProxy fixture：默认 connected、
// FreeBusy 全空（任何政策通过的 slot 可订）、InsertEvent 成功。
// failure="notconnected" → Connected=false；failure="conflict" → 整个查询窗
// 标忙（命中 all-busy 路径让 agent 解释）。
type cannedCalendarProxy struct {
	failure string
}

func (p cannedCalendarProxy) Connected(_ context.Context, _ string) (bool, error) {
	return p.failure != "notconnected", nil
}

func (p cannedCalendarProxy) FreeBusy(
	_ context.Context, _ string, req usecases.FreeBusyReq,
) ([]usecases.BusyInterval, error) {
	if p.failure == "conflict" {
		return []usecases.BusyInterval{{Start: req.TimeMin, End: req.TimeMax}}, nil
	}
	return []usecases.BusyInterval{}, nil
}

func (cannedCalendarProxy) InsertEvent(
	_ context.Context, _ string, _ *usecases.InsertEventReq,
) (usecases.InsertedEvent, error) {
	return usecases.InsertedEvent{
		EventID:  "evt_eval_canned",
		HTMLLink: "https://calendar.google.com/event?eid=evt_eval_canned",
	}, nil
}

func (cannedCalendarProxy) DeleteEvent(_ context.Context, _, _, _ string) error {
	return nil
}
