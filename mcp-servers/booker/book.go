// book.go —— the calendar_book main flow, ported from the old core usecases/calendar_book.go
// + capreg_booker_book.go.
// #135: the logic lives in the sandbox; everything external goes through a fixed vocabulary
// —— calendar insert/delete/freebusy via connector.invoke, booking storage/counting (quota)
// via capstore, owner timezone via owner.meta. The result wire stays **byte-aligned** with
// the old host (the frontend card decodes it unchanged).

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	minDurationMin = 15
	maxDurationMin = 180
	bookingsColl   = "bookings"
)

type bookArgs struct {
	Topic          string      `json:"topic"`
	PreferredTimes []time.Time `json:"preferred_times"`
	DurationMin    int         `json:"duration_min"`
}

func validateBookArgs(a *bookArgs) error {
	if a.Topic == "" {
		return errors.New("missing topic")
	}
	if a.DurationMin < minDurationMin || a.DurationMin > maxDurationMin {
		return fmt.Errorf("duration_min must be %d–%d", minDurationMin, maxDurationMin)
	}
	if len(a.PreferredTimes) == 0 {
		return errors.New("preferred_times required")
	}
	return nil
}

// ── wire (same keys as the old capreg_booker_book.go) ──

type bookErrWire struct {
	Error  string `json:"error"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

// bookOKWire —— the receipt for a successful booking. **Every field says something,
// including the "nothing" case**.
//
// InvitedEmail used to be called VisitorEmail and carried `omitempty`: when the visitor gave
// no email it vanished entirely, leaving the receipt as just
// `{ok, event_id, html_link, start, end, can_email:true}`. But can_email says whether the
// owner **can** send email, not **who was invited** this time. The model then had nothing to
// contradict "the invite has already been sent" with —— and since the prompt also told it
// "invite goes to the email the visitor entered (if they gave one)" —— it picked an address
// out of the conversation body and told the visitor "the calendar invite will go to X."
// The real inbox was empty, and the real event had no attendees at all (F-B-6). **Omission is
// not null**: the field is always present, and an empty string means "nobody was invited."
type bookOKWire struct {
	EventID  string `json:"event_id"`
	HTMLLink string `json:"html_link"`
	Start    string `json:"start"`
	End      string `json:"end"`
	// InvitedEmail —— the address actually added to the guest list, the one that actually
	// gets the invite; empty string = nobody.
	InvitedEmail string `json:"invited_email"`
	OK           bool   `json:"ok"`
	CanEmail     bool   `json:"can_email"`
}

// bookConflictWire —— this slot was just taken by someone else. **Not an error**: what the
// caller (and the model) wants is "pick another time," not "something broke." The shape
// matches other conflict receipts (`ok:false` + `conflict`), which the card and the model
// already know how to read.
type bookConflictWire struct {
	Conflict string `json:"conflict"`
	Detail   string `json:"detail"`
	OK       bool   `json:"ok"`
}

// slotHoldSeconds —— how long the hold lasts. Long enough to cover "insert the event +
// persist it" (measured in seconds normally, up to the low tens on a slow cold start), yet
// short enough that one crash doesn't lock the slot for long.
const slotHoldSeconds = 60

// slotHoldKey —— which slot. owner + start/end time: only one person can be booking the same
// owner's same time window at once, and different owners never affect each other.
func slotHoldKey(ownerID string, start, end time.Time) string {
	return "slot:" + ownerID + ":" + start.UTC().Format(time.RFC3339) +
		"-" + end.UTC().Format(time.RFC3339)
}

type busyWindow struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type bookFailWire struct {
	Conflict    string       `json:"conflict"`
	PolicyHint  string       `json:"policy_hint,omitempty"`
	BusyWindows []busyWindow `json:"busy_windows,omitempty"`
	OK          bool         `json:"ok"`
}

func bookErr(reason, detail string) string {
	return mustJSON(bookErrWire{OK: false, Error: reason, Detail: detail})
}

func bookFailResult(conflict, hint string, busy []busyInterval) string {
	wins := make([]busyWindow, 0, len(busy))
	for i := range busy {
		wins = append(wins, busyWindow{
			Start: busy[i].Start.Format(time.RFC3339),
			End:   busy[i].End.Format(time.RFC3339),
		})
	}
	if conflict != conflictAllBusy {
		wins = nil
	}
	return mustJSON(bookFailWire{OK: false, Conflict: conflict, PolicyHint: hint, BusyWindows: wins})
}

// insertedEvent —— the response from connector.invoke insert_event (InsertedEvent json tags).
type insertedEvent struct {
	EventID  string `json:"event_id"`
	HTMLLink string `json:"html_link"`
}

// bookingDoc —— one booking as stored in the booker capstore (cancel looks it up by
// conversation, quota counts by subject).
type bookingDoc struct {
	OwnerID string `json:"owner_id"`
	// SubjectID / SubjectKind —— **who** made this booking: an access code, or an outbound
	// API key. The host counts usage by SubjectID (the manifest's QuotaDecl.SubjectField).
	// This used to only have `code_id`, so a booking made via the key path had no subject to
	// count against, and never got gated at all (F-B-11).
	SubjectID      string    `json:"subject_id"`
	SubjectKind    string    `json:"subject_kind"`
	ConversationID string    `json:"conversation_id"`
	GoogleEventID  string    `json:"google_event_id"`
	GoogleHTMLLink string    `json:"google_html_link"`
	Summary        string    `json:"summary"`
	VisitorEmail   string    `json:"visitor_email"`
	StartAt        time.Time `json:"start_at"`
	EndAt          time.Time `json:"end_at"`
}

// doBook —— the sandboxed implementation of calendar_book. Returns the wire JSON given back
// to the agent (errors too are {ok:false,...}).
func doBook(s session, rawArgs json.RawMessage) string {
	var args bookArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	if verr := validateBookArgs(&args); verr != nil {
		return bookErr("invalid_args", verr.Error())
	}
	// The quota gate lives on the host side (the composition root reads the booker capstore
	// count and hides the tool outright once the limit is hit), so reaching this point means
	// there's still quota left —— booker doesn't check again.
	return runBook(s, &args)
}

func runBook(s session, args *bookArgs) string {
	policy, perr := loadPolicy(s.OwnerID)
	if perr != nil {
		return friendlyCalErr(perr)
	}
	tz, _ := gwOwnerMeta(s.OwnerID, "timezone")
	passed, worst := collectPassing(&policy, tz, args)
	if len(passed) == 0 {
		return bookFailResult(worst, policyHint(&policy, tz), nil)
	}
	span := freebusySpan(passed, args.DurationMin)
	busy, ferr := gwFreeBusy(s.OwnerID, span.min, span.max)
	if ferr != nil {
		return friendlyCalErr(ferr)
	}
	slot, ok := pickFreeSlot(passed, args.DurationMin, busy)
	if !ok {
		return bookFailResult(conflictAllBusy, policyHint(&policy, tz), busy)
	}
	return commitBooking(s, args, tz, slot)
}

// collectPassing —— runs each preferred_time through the policy; returns the ones that pass +
// the worst conflict reason (used when none pass).
func collectPassing(policy *bookingPolicy, tz string, args *bookArgs) ([]time.Time, string) {
	var passed []time.Time
	worst := ""
	for _, t := range args.PreferredTimes {
		reason, err := evaluatePolicy(policy, tz, t, args.DurationMin)
		if err != nil {
			continue
		}
		if reason != "" {
			worst = reason
			continue
		}
		passed = append(passed, t)
	}
	return passed, worst
}

type spanRange struct{ min, max time.Time }

func freebusySpan(slots []time.Time, durationMin int) spanRange {
	r := spanRange{min: slots[0], max: slots[0]}
	for _, s := range slots {
		if s.Before(r.min) {
			r.min = s
		}
		if s.After(r.max) {
			r.max = s
		}
	}
	r.max = r.max.Add(time.Duration(durationMin) * time.Minute)
	return r
}

func pickFreeSlot(slots []time.Time, durationMin int, busy []busyInterval) (time.Time, bool) {
	dur := time.Duration(durationMin) * time.Minute
	for _, s := range slots {
		if !slotConflicts(s, dur, busy) {
			return s, true
		}
	}
	return time.Time{}, false
}

// commitBooking —— claims the slot → inserts the event → persists it; if persist fails,
// compensates by deleting the event (no orphaned event left with no booking behind it).
//
// **Claim the slot before inserting**: there's a window between the free/busy check and the
// insert, and two requests arriving at the same time can both see the same slot as "free"
// and each go ahead and book it —— this really happened in prod, two events side by side on
// the real calendar (F-B-15). The claim is guaranteed by the host via a primary-key conflict,
// not by any ordering here.
func commitBooking(s session, args *bookArgs, tz string, slot time.Time) string {
	end := slot.Add(time.Duration(args.DurationMin) * time.Minute)
	summary := buildSummary(s.VisitorName, args.Topic)
	holdKey := slotHoldKey(s.OwnerID, slot, end)
	if !gwCapstoreClaim(bookingsColl, holdKey, slotHoldSeconds) {
		return mustJSON(bookConflictWire{
			OK: false, Conflict: "just_taken",
			Detail: "that time was taken a moment ago — pick another slot",
		})
	}
	inserted, ierr := insertEvent(s, args, tz, slot, end, summary)
	if ierr != nil {
		gwCapstoreRelease(bookingsColl, holdKey) // booking failed, don't leave the slot locked until the TTL expires
		return friendlyCalErr(ierr)
	}
	if perr := persistBooking(s, &inserted, summary, slot, end); perr != nil {
		compensateDelete(s, inserted.EventID)
		gwCapstoreRelease(bookingsColl, holdKey)
		return friendlyCalErr(perr)
	}
	// #130 owner-notify: the booking has already succeeded, the notification is a
	// best-effort tail — a failure here just means no message went out.
	notifyOwnerOfBooking(s, &bookingDoc{
		OwnerID: s.OwnerID, SubjectID: s.SubjectID, SubjectKind: s.SubjectKind,
		GoogleEventID: inserted.EventID,
		Summary:       summary, VisitorEmail: s.VisitorEmail, StartAt: slot, EndAt: end,
	})
	return mustJSON(bookOKWire{
		OK: true, EventID: inserted.EventID, HTMLLink: inserted.HTMLLink,
		Start: slot.Format(time.RFC3339), End: end.Format(time.RFC3339),
		InvitedEmail: s.VisitorEmail, CanEmail: ownerCanEmail(s.OwnerID),
	})
}

func insertEvent(
	s session, args *bookArgs, tz string, slot, end time.Time, summary string,
) (insertedEvent, error) {
	req, _ := json.Marshal(map[string]any{
		"summary": summary, "description": args.Topic,
		"start": slot, "end": end, "time_zone": tz, "visitor_email": s.VisitorEmail,
	})
	resp, err := gwConnectorInvoke(s.OwnerID, "calendar", "insert_event", req)
	if err != nil {
		return insertedEvent{}, err
	}
	var ev insertedEvent
	if uerr := json.Unmarshal(resp, &ev); uerr != nil {
		return insertedEvent{}, fmt.Errorf("decode insert_event: %w", uerr)
	}
	return ev, nil
}

func persistBooking(s session, ev *insertedEvent, summary string, start, end time.Time) error {
	doc, _ := json.Marshal(bookingDoc{
		OwnerID: s.OwnerID, SubjectID: s.SubjectID, SubjectKind: s.SubjectKind,
		ConversationID: s.ConversationID,
		GoogleEventID:  ev.EventID, GoogleHTMLLink: ev.HTMLLink, Summary: summary,
		VisitorEmail: s.VisitorEmail, StartAt: start, EndAt: end,
	})
	if _, err := gwCapstoreInsert(bookingsColl, doc); err != nil {
		return err
	}
	return nil
}

func compensateDelete(s session, eventID string) {
	req, _ := json.Marshal(map[string]string{"event_id": eventID, "attendee_email": s.VisitorEmail})
	_, _ = gwConnectorInvoke(s.OwnerID, "calendar", "delete_event", req)
}

// ownerCanEmail —— whether the owner has a usable mail connector (decides whether the
// confirmation-email widget shows up on the card).
func ownerCanEmail(ownerID string) bool {
	resp, err := gwConnectorInvoke(ownerID, "mail", "connected", nil)
	if err != nil {
		return false
	}
	var r struct {
		Connected bool `json:"connected"`
	}
	return json.Unmarshal(resp, &r) == nil && r.Connected
}

// ownerCanBook —— whether the owner's calendar authorization allows writing (decides whether
// the time-slot card's chip can be clicked).
// Same shape as ownerCanEmail: **don't offer an entry point for an action that can't be
// done**. When it can't answer, treat it as "can't": this control would rather offer one
// fewer entry point than one that does nothing when pressed.
func ownerCanBook(ownerID string) bool {
	args, _ := json.Marshal(map[string]string{"operation": "events.insert"})
	resp, err := gwConnectorInvoke(ownerID, "calendar", "can_perform", args)
	if err != nil {
		return false
	}
	var r struct {
		Can bool `json:"can"`
	}
	return json.Unmarshal(resp, &r) == nil && r.Can
}

func buildSummary(visitorName, topic string) string {
	parts := make([]string, 0, 2)
	if visitorName != "" {
		parts = append(parts, visitorName)
	}
	parts = append(parts, topic)
	return strings.Join(parts, " — ")
}

// friendlyCalErr —— every underlying error gets degraded to a friendly message; never leak a
// socket/connector internal error to the visitor.
func friendlyCalErr(err error) string {
	switch {
	case err != nil && strings.Contains(err.Error(), "not connected"):
		return bookErr("not_connected", "owner has not connected a calendar yet")
	default:
		return bookErr("calendar_unavailable",
			"the calendar service is temporarily unavailable — please try again later")
	}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(b)
}
