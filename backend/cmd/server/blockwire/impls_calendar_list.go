// impls_calendar_list.go —— the owner op that lists the connected account's calendars.
//
// Split from impls.go (which holds calendar.check + mail.test_send) to keep each file under the
// max-lines ceiling, and along a real seam: this file answers "what calendars does the owner have",
// so switching which calendar bookings land on is a pick, not a hand-typed collection URL.

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// verbCaller — a supplier that accepts a raw seam verb (the block-backed proxy). The openapi
// (google-calendar) adapter does not implement it, so a type-assert failure IS the answer
// "this provider can't list calendars" rather than a crash.
type verbCaller interface {
	CallVerb(
		ctx context.Context, ownerID, verb string, args json.RawMessage,
	) (json.RawMessage, error)
}

// noListableCalendar / calendarListUnreadable — the two failure sentences (owner-facing, no status
// code or hostname), same discipline as calendarFailureReason.
const noListableCalendar = "no calendar that can list its calendars is connected — " +
	"connect a CalDAV calendar first"
const calendarListUnreadable = "couldn't read the calendar list — please try again later"

// calendarRow / calendarListOut — the owner-facing shape: the account's calendars by name + URL,
// so switching calendars is a pick, not a hand-typed collection URL. Reason on the failure side,
// same discipline as calendarCheckOut.
type calendarRow struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type calendarListOut struct {
	Reason    string        `json:"reason,omitempty"`
	Summary   string        `json:"summary,omitempty"`
	Calendars []calendarRow `json:"calendars"`
	OK        bool          `json:"ok"`
}

// calendarListCalendars — discover the connected account's calendars using the stored credentials.
// Read-only. The block walks principal → calendar-home-set → the calendars under it; the host only
// injects creds and shapes the reply.
func calendarListCalendars(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		return json.Marshal(runCalendarList(ctx, d, ownerID))
	}
}

func runCalendarList(ctx context.Context, d *deps.Runtime, ownerID string) calendarListOut {
	// No calendar connected, or one (openapi google-calendar) that can't enumerate — the same
	// honest answer, not a panic through a nil/wrong handle.
	caller, ok := activeSupplier(ctx, d, ownerID, "calendar").(verbCaller)
	if !ok {
		return calendarListFail(noListableCalendar)
	}
	raw, err := caller.CallVerb(ctx, ownerID, "list_calendars", json.RawMessage(`{}`))
	if err != nil {
		d.Log.Warn("suppliers.calendar_list", "err", err)
		return calendarListFail(calendarFailureReason(err))
	}
	var reply struct {
		Calendars []calendarRow `json:"calendars"`
	}
	if uerr := json.Unmarshal(raw, &reply); uerr != nil {
		d.Log.Warn("suppliers.calendar_list decode", "err", uerr)
		return calendarListFail(calendarListUnreadable)
	}
	return calendarListOut{
		OK: true, Calendars: nonNilRows(reply.Calendars),
		Summary: calendarCountSummary(len(reply.Calendars)),
	}
}

// calendarListFail / nonNilRows / calendarCountSummary — small shapers so runCalendarList stays
// under the cyclo ceiling and Calendars is always a JSON array (never null) for the owner's client.
func calendarListFail(reason string) calendarListOut {
	return calendarListOut{Calendars: []calendarRow{}, Reason: reason}
}

func calendarCountSummary(n int) string {
	return fmt.Sprintf("Found %d %s.", n, plural(n, "calendar", "calendars"))
}

func nonNilRows(rows []calendarRow) []calendarRow {
	if rows == nil {
		return []calendarRow{}
	}
	return rows
}
