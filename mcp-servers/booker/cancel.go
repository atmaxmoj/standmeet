// cancel.go —— calendar_cancel + calendar_reschedule, ported from the old
// capreg_booker_cancel.go / _reschedule.go. Isolation relies on the host-planted
// ConversationID (not LLM-controlled): only touches the booking for **this
// conversation**.
// Cancel = delete the calendar event + delete the booker capstore record;
// reschedule = book the new one first (doesn't count against quota, it's a
// move) → then delete the old one once it succeeds.

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type cancelArgs struct {
	EventID string `json:"event_id"`
}

type rescheduleArgs struct {
	EventID        string      `json:"event_id"`
	PreferredTimes []time.Time `json:"preferred_times"`
	DurationMin    int         `json:"duration_min"`
}

// resolveConvBooking —— this conversation's most recent booking + a
// defensive check that event_id belongs to it. Non-empty errWire = return it directly.
func resolveConvBooking(s session, eventID string) (bookingDoc, string) {
	filter, _ := json.Marshal(map[string]string{"conversation_id": s.ConversationID})
	recs, err := gwCapstoreQuery(bookingsColl, filter)
	if err != nil {
		return bookingDoc{}, bookErr("cancel_failed",
			"couldn't reach the booking right now — please try again later")
	}
	if len(recs) == 0 {
		return bookingDoc{}, bookErr("booking_not_found", "no booking found to cancel")
	}
	latest := latestBooking(recs)
	if eventID != "" && eventID != latest.GoogleEventID {
		return bookingDoc{}, bookErr("booking_not_found", "no matching booking to cancel")
	}
	return latest, ""
}

func latestBooking(recs []json.RawMessage) bookingDoc {
	var latest bookingDoc
	for i := range recs {
		var b bookingDoc
		if json.Unmarshal(recs[i], &b) != nil {
			continue
		}
		if b.StartAt.After(latest.StartAt) {
			latest = b
		}
	}
	return latest
}

// deleteBooking —— delete the calendar event + delete the capstore record
// (deletes precisely by conversation + event_id, so it never hits another booking by mistake).
func deleteBooking(ownerID string, b *bookingDoc) error {
	delReq, _ := json.Marshal(map[string]string{
		"event_id": b.GoogleEventID, "attendee_email": b.VisitorEmail,
	})
	if _, err := gwConnectorInvoke(ownerID, "calendar", "delete_event", delReq); err != nil {
		return err
	}
	filter, _ := json.Marshal(map[string]string{
		"conversation_id": b.ConversationID, "google_event_id": b.GoogleEventID,
	})
	if _, err := gwCapstoreDelete(bookingsColl, filter); err != nil {
		return err
	}
	return nil
}

func doCancel(s session, rawArgs json.RawMessage) string {
	var args cancelArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	booking, ew := resolveConvBooking(s, args.EventID)
	if ew != "" {
		return ew
	}
	if derr := deleteBooking(s.OwnerID, &booking); derr != nil {
		return bookErr("cancel_failed",
			"couldn't cancel the meeting right now — please try again later")
	}
	return `{"ok":true,"cancelled":true}`
}

func validateRescheduleArgs(a *rescheduleArgs) error {
	if len(a.PreferredTimes) == 0 {
		return errors.New("preferred_times required")
	}
	if a.DurationMin < minDurationMin || a.DurationMin > maxDurationMin {
		return fmt.Errorf("duration_min must be %d–%d", minDurationMin, maxDurationMin)
	}
	return nil
}

func doReschedule(s session, rawArgs json.RawMessage) string {
	var args rescheduleArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	if verr := validateRescheduleArgs(&args); verr != nil {
		return bookErr("invalid_args", verr.Error())
	}
	old, ew := resolveConvBooking(s, args.EventID)
	if ew != "" {
		return ew
	}
	// Book the new one: doesn't count against quota (a move, not an addition);
	// topic carries over the old summary, VisitorName is cleared (avoids a repeated prefix).
	s2 := s
	s2.VisitorName = ""
	wire := runBook(s2, &bookArgs{
		Topic: old.Summary, PreferredTimes: args.PreferredTimes, DurationMin: args.DurationMin,
	})
	if !wireOK(wire) {
		return wire // conflict/policy/fully booked: the original booking is untouched, return the failure as-is
	}
	_ = deleteBooking(s.OwnerID, &old) // best-effort: the new one already succeeded; a failed delete of the old one doesn't roll back (would rather leave a stray old event)
	return wire
}

// wireOK —— parses the wire's {ok} field.
func wireOK(wire string) bool {
	var r struct {
		OK bool `json:"ok"`
	}
	return json.Unmarshal([]byte(wire), &r) == nil && r.OK
}
