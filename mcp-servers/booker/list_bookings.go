// list_bookings.go —— the owner-facing bookings_list: lists the meetings this owner has
// already booked.
//
// Why it lives in the sandbox: booked meetings live in booker's **own** isolated
// store — they're booker's data. The host side used to have an admin REST route that
// queried this store directly (admin/bookings.go + booking_store_deps.go + a
// CodeBooking type) — that meant the host knew the shape of booker's data.
//
// The specific reason this couldn't move over before: the list needs to carry the
// **record id** (cancellation looks it up by id), and the reach-back fixed verb list
// only had insert/query/count/delete — no "query and return the id". This works now
// that capstore.query_records has been added.

package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

const (
	listBookingsDefaultLimit = 50
	listBookingsMaxLimit     = 200
)

type listBookingsArgs struct {
	Limit int `json:"limit"`
}

// bookingRow —— one outbound booking. id is the record id, looked up by it on cancel.
type bookingRow struct {
	ID             string `json:"id"`
	StartAt        string `json:"start_at"`
	EndAt          string `json:"end_at"`
	Summary        string `json:"summary"`
	VisitorEmail   string `json:"visitor_email"`
	SubjectID      string `json:"subject_id"`
	SubjectKind    string `json:"subject_kind"`
	ConversationID string `json:"conversation_id"`
	GoogleEventID  string `json:"google_event_id,omitempty"`
	GoogleHTMLLink string `json:"google_html_link,omitempty"`
}

// doListBookings —— lists booked meetings for the owner, most recent first.
func doListBookings(s session, rawArgs json.RawMessage) string {
	args := listBookingsArgs{Limit: listBookingsDefaultLimit}
	if len(rawArgs) > 0 {
		if err := json.Unmarshal(rawArgs, &args); err != nil {
			return bookErr("invalid_args", err.Error())
		}
	}
	rows, err := loadBookings(s.OwnerID, clampListLimit(args.Limit))
	if err != nil {
		return bookErr("list_failed", err.Error())
	}
	out, merr := json.Marshal(map[string][]bookingRow{"bookings": rows})
	if merr != nil {
		return bookErr("list_failed", "encode bookings: "+merr.Error())
	}
	return string(out)
}

func clampListLimit(n int) int {
	if n <= 0 {
		return listBookingsDefaultLimit
	}
	if n > listBookingsMaxLimit {
		return listBookingsMaxLimit
	}
	return n
}

func loadBookings(ownerID string, limit int) ([]bookingRow, error) {
	filter, merr := json.Marshal(map[string]string{"owner_id": ownerID})
	if merr != nil {
		return nil, fmt.Errorf("bookings filter: %w", merr)
	}
	recs, err := gwCapstoreQueryRecords(bookingsColl, filter)
	if err != nil {
		return nil, err
	}
	rows := make([]bookingRow, 0, len(recs))
	for i := range recs {
		var doc bookingDoc
		if uerr := json.Unmarshal(recs[i].Doc, &doc); uerr != nil {
			continue // one bad document shouldn't keep the whole list from loading
		}
		rows = append(rows, toBookingRow(recs[i].ID, &doc))
	}
	sort.Slice(rows, func(a, b int) bool { return rows[a].StartAt > rows[b].StartAt })
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func toBookingRow(id string, d *bookingDoc) bookingRow {
	return bookingRow{
		ID: id, Summary: d.Summary, VisitorEmail: d.VisitorEmail,
		SubjectID: d.SubjectID, SubjectKind: d.SubjectKind,
		ConversationID: d.ConversationID,
		GoogleEventID:  d.GoogleEventID, GoogleHTMLLink: d.GoogleHTMLLink,
		StartAt: d.StartAt.UTC().Format(time.RFC3339),
		EndAt:   d.EndAt.UTC().Format(time.RFC3339),
	}
}
