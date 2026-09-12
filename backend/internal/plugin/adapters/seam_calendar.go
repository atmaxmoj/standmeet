// seam_calendar.go —— the supplier axis's typed SEAM contracts (#135 Slice A).
//
// These are the typed proxy interfaces + DTOs a block uses to reach a
// SEAM (calendar, …) without knowing the provider. They live OUTSIDE the kernel:
// the supplier adapters in this package implement them, the block plugins
// (mcp-servers/booker) consume them, and the composition root wires the concrete
// adapter in. The kernel (usecases/inference/domain) holds NO typed seam surface —
// so booking logic has nothing to call there; that is the "un-writable" lock.
//
// Provider-agnostic by construction: pure time/string DTOs, no gcal/caldav types.

package adapters

import (
	"context"
	"time"
)

// CalendarProxy —— the invocation surface for the outbound calendar supplier. ownerID =
// handle; credentials and token refresh live entirely on the implementation side
// (this package), never reaching the consumer.
type CalendarProxy interface {
	// Connected —— whether the supplier is usable (has credentials + is authorized).
	Connected(ctx context.Context, ownerID string) (bool, error)
	// FreeBusy —— the owner's primary calendar's busy intervals within [TimeMin,TimeMax].
	FreeBusy(ctx context.Context, ownerID string, req FreeBusyReq) ([]BusyInterval, error)
	// InsertEvent —— create an event on the owner's primary calendar, return the event id +
	// link.
	InsertEvent(ctx context.Context, ownerID string, req *InsertEventReq) (InsertedEvent, error)
	// DeleteEvent —— delete an event (404/410 counts as success, absorbed by the adapter).
	// attendeeEmail non-empty → notify the attendee of the cancellation (sendUpdates=all).
	DeleteEvent(ctx context.Context, ownerID, eventID, attendeeEmail string) error
}

// FreeBusyReq —— FreeBusy's input (UTC time window). The json tags declare the wire shape
// supplier.invoke reaches back with.
type FreeBusyReq struct {
	TimeMin time.Time `json:"time_min"`
	TimeMax time.Time `json:"time_max"`
}

// BusyInterval —— one busy interval.
type BusyInterval struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

// InsertEventReq —— InsertEvent's input. VisitorEmail empty = no attendee added, no
// notification sent.
type InsertEventReq struct {
	Summary      string    `json:"summary"`
	Description  string    `json:"description"`
	Start        time.Time `json:"start"`
	End          time.Time `json:"end"`
	TimeZone     string    `json:"time_zone"`
	VisitorEmail string    `json:"visitor_email"`
}

// InsertedEvent —— the identifier of the created event.
type InsertedEvent struct {
	EventID  string `json:"event_id"`
	HTMLLink string `json:"html_link"`
}
