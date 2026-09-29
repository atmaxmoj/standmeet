package blockwire

import (
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

// TestInsertEventArgsForwardsEveryField — a booking's Description (Topic / With / Contact) and
// TimeZone were dropped between the seam DTO and the block's insert_event tool, so calendar events
// landed as a bare summary. This locks every seam field through the mapping.
func TestInsertEventArgsForwardsEveryField(t *testing.T) {
	t.Parallel()
	start, err := time.Parse(time.RFC3339, "2026-09-22T14:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	req := &adapters.InsertEventReq{
		Summary:      "Chat with Zhang",
		Description:  "Booked via StandMeet.\nTopic: partnership\nWith: Zhang",
		Start:        start,
		End:          start.Add(time.Hour),
		TimeZone:     "America/Toronto",
		VisitorEmail: "z@example.com",
	}
	got := insertEventArgs(req)
	for _, c := range []struct{ name, got, want string }{
		{"description", got.Description, req.Description},
		{"time_zone", got.TimeZone, req.TimeZone},
		{"summary", got.Summary, req.Summary},
		{"visitor_email", got.VisitorEmail, req.VisitorEmail},
		{"start", nonEmpty(got.Start), "set"},
		{"end", nonEmpty(got.End), "set"},
	} {
		if c.got != c.want {
			t.Fatalf("field %q not forwarded: got %q want %q", c.name, c.got, c.want)
		}
	}
}

// nonEmpty — "set" for a non-empty string, "" otherwise (the start/end are formatted timestamps,
// so the mapping only needs to prove they weren't dropped, not re-check the format).
func nonEmpty(s string) string {
	if s == "" {
		return ""
	}
	return "set"
}
