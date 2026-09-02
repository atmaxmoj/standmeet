// cancel_owner.go —— the owner-face cancel: cancel a booked meeting by
// **booking id**.
//
// Why this lives in the sandbox: canceling a booking means deleting the calendar
// event + deleting that row from our own storage — both steps are booker's
// business. The host side once implemented these same two steps a second time
// (uc_booking_cancel.go / uc_booking_cancel_own.go / ownercore's cap_calendar);
// the only difference was "how to find that row" — the owner looks it up by
// booking id, the visitor by session + event id.
//
// The root of this duplication was a mechanism gap: the sandbox used to have no
// way to get at its own records' ids (the reach-back fixed vocabulary only had
// insert/query/count/delete), so "cancel by id" had to be written on the host
// side. Now that capstore.query_records / delete_by_id have been added, this can
// use booker's own deleteBooking.

package main

import (
	"encoding/json"
	"errors"
	"fmt"
)

// errBookingNotFound —— no row for this owner was found by id. Doesn't
// distinguish "doesn't exist" from "isn't yours": neither should leak existence.
var errBookingNotFound = errors.New("booking not found")

type cancelByIDArgs struct {
	BookingID string `json:"booking_id"`
}

// doCancelByID —— owner cancels a booking. Not found just means not found
// (doesn't distinguish "doesn't exist" from "isn't yours" — neither should leak
// existence).
func doCancelByID(s session, rawArgs json.RawMessage) string {
	var args cancelByIDArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	if args.BookingID == "" {
		return bookErr("invalid_args", "booking_id is required")
	}
	rec, doc, err := findOwnedBooking(s.OwnerID, args.BookingID)
	if err != nil {
		return bookErr("not_found", err.Error())
	}
	if derr := deleteBookingByRecord(s.OwnerID, rec, doc); derr != nil {
		return bookErr("cancel_failed", derr.Error())
	}
	// The response shape follows the contract host already shipped (the owner's
	// AI client reads it by that contract).
	out, merr := json.Marshal(map[string]any{
		"booking_id":      args.BookingID,
		"google_event_id": doc.GoogleEventID,
		"summary":         doc.Summary,
		"cancelled":       true,
		"sent_updates_to": doc.VisitorEmail,
	})
	if merr != nil {
		return bookErr("cancel_failed", merr.Error())
	}
	return string(out)
}

// findOwnedBooking —— finds this owner's row by id. owner_id goes into the filter
// too: even a guessed id belonging to someone else won't get through.
func findOwnedBooking(ownerID, bookingID string) (string, *bookingDoc, error) {
	filter, merr := json.Marshal(map[string]string{"owner_id": ownerID})
	if merr != nil {
		return "", nil, fmt.Errorf("bookings filter: %w", merr)
	}
	recs, err := gwCapstoreQueryRecords(bookingsColl, filter)
	if err != nil {
		return "", nil, err
	}
	for i := range recs {
		if recs[i].ID != bookingID {
			continue
		}
		var doc bookingDoc
		if uerr := json.Unmarshal(recs[i].Doc, &doc); uerr != nil {
			return "", nil, fmt.Errorf("decode booking: %w", uerr)
		}
		return recs[i].ID, &doc, nil
	}
	return "", nil, errBookingNotFound
}

// deleteBookingByRecord —— deletes the calendar event + deletes its own row by
// record id.
//
// This is the same thing as deleteBooking (the session-side one) — the storage
// deletion step just goes by id instead of by filter. The lookup differs; the
// action is the same code.
func deleteBookingByRecord(ownerID, recordID string, b *bookingDoc) error {
	delReq, merr := json.Marshal(map[string]string{
		"event_id": b.GoogleEventID, "attendee_email": b.VisitorEmail,
	})
	if merr != nil {
		return fmt.Errorf("delete request: %w", merr)
	}
	if _, err := gwConnectorInvoke(ownerID, "calendar", "delete_event", delReq); err != nil {
		return err
	}
	if _, err := gwCapstoreDeleteByID(bookingsColl, recordID); err != nil {
		return err
	}
	return nil
}
