// confirm.go —— send_confirmation, ported from the old booking_confirmation*.go. Locates this
// conversation's most recent booking → checks ownership (owner+code) → idempotency (a confirmations
// marker, one send per booking) → picks the recipient (passthrough / falls back to the session
// email) → renders the confirmation (text + HTML + schema.org JSON-LD) → sends via
// connector.invoke("mail","send"). The recipient is pinned to a host-side value (session email / the
// address on the card), the LLM never touches it.

package main

import (
	"encoding/json"
	"fmt"
	"html"
	"net/mail"
	"time"
)

const confirmationsColl = "confirmations"

type sendConfirmationArgs struct {
	Recipient string `json:"recipient"`
	TZ        string `json:"tz"`
}

// confirmationMarker —— the marker that a confirmation has already been sent (one record per event_id, for idempotency).
type confirmationMarker struct {
	GoogleEventID  string `json:"google_event_id"`
	ConversationID string `json:"conversation_id"`
}

func doSendConfirmation(s session, rawArgs json.RawMessage) string {
	var args sendConfirmationArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	booking, ew := resolveConfirmBooking(s)
	if ew != "" {
		return ew
	}
	to, rew := pickRecipient(args.Recipient, s.VisitorEmail)
	if rew != "" {
		return rew
	}
	return deliverConfirmation(s, &booking, to, args.TZ)
}

func resolveConfirmBooking(s session) (bookingDoc, string) {
	filter, _ := json.Marshal(map[string]string{"conversation_id": s.ConversationID})
	recs, err := gwCapstoreQuery(bookingsColl, filter)
	if err != nil {
		return bookingDoc{}, bookErr("send_failed", "couldn't reach the booking — please try again later")
	}
	if len(recs) == 0 {
		return bookingDoc{}, bookErr("booking_not_found", "no booking found for this conversation")
	}
	b := latestBooking(recs)
	// Only recognized if it's the same owner **and** the same subject: someone who switched to a
	// different code / a different key shouldn't be able to send a confirmation for someone else's booking.
	if b.OwnerID != s.OwnerID || b.SubjectID != s.SubjectID {
		return bookingDoc{}, bookErr("booking_not_found", "no booking found for this conversation")
	}
	return b, ""
}

func pickRecipient(passthrough, sessionEmail string) (string, string) {
	to := passthrough
	if to == "" {
		to = sessionEmail
	}
	if _, perr := mail.ParseAddress(to); to == "" || perr != nil {
		return "", bookErr("no_recipient", "no email address to send the confirmation to")
	}
	return to, ""
}

// deliverConfirmation —— idempotency claim (insert marker) → send mail → release (delete marker, allowing retry) on failure.
func deliverConfirmation(s session, b *bookingDoc, to, tz string) string {
	if sent, cerr := confirmationSent(b.GoogleEventID); cerr != nil {
		return bookErr("send_failed", "couldn't send the confirmation right now — please try again later")
	} else if sent {
		return bookErr("already_sent", "confirmation already sent for this booking")
	}
	marker, _ := json.Marshal(confirmationMarker{
		GoogleEventID: b.GoogleEventID, ConversationID: b.ConversationID,
	})
	if _, ierr := gwCapstoreInsert(confirmationsColl, marker); ierr != nil {
		return bookErr("send_failed", "couldn't send the confirmation right now — please try again later")
	}
	if serr := sendConfirmationMail(s.OwnerID, b, to, tz); serr != "" {
		releaseConfirmation(b.GoogleEventID)
		return serr
	}
	return `{"ok":true}`
}

func confirmationSent(eventID string) (bool, error) {
	filter, _ := json.Marshal(map[string]string{"google_event_id": eventID})
	n, err := gwCapstoreCount(confirmationsColl, filter)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func releaseConfirmation(eventID string) {
	filter, _ := json.Marshal(map[string]string{"google_event_id": eventID})
	_, _ = gwCapstoreDelete(confirmationsColl, filter)
}

// sendConfirmationMail —— renders the mail + sends via the mail connector. Returns errWire (empty = success).
func sendConfirmationMail(ownerID string, b *bookingDoc, to, tz string) string {
	ownerName, _ := gwOwnerMeta(ownerID, "full_name")
	ownerTZ, _ := gwOwnerMeta(ownerID, "timezone")
	msg := buildConfirmationEmail(b, ownerName, tz, ownerTZ)
	msg["to"] = to
	payload, _ := json.Marshal(msg)
	if _, err := gwConnectorInvoke(ownerID, "mail", "send", payload); err != nil {
		return mailSendErr(err)
	}
	return ""
}

// mailSendErr —— **two kinds of failure, two different messages** (F-C-42).
//
// This used to say "the owner hasn't set up email" for any error. When the owner had configured it
// and it just couldn't be reached at that moment, that sentence was **false** to the visitor, and it
// leaked the owner's configuration status besides. Now it branches on the category the host gives:
// if the category is missing (an old host / no code attached), it takes the conservative branch —
// saying "can't send right now" is never a lie, saying "never configured" can be.
func mailSendErr(err error) string {
	if faultCode(err) == faultNotConfigured {
		return bookErr("mail_not_configured", "the owner hasn't set up email yet")
	}
	return bookErr("mail_send_failed",
		"couldn't send the confirmation right now — the booking is still yours; try again in a bit")
}

// ── mail template (ported from booking_confirmation_email.go) ──

func buildConfirmationEmail(b *bookingDoc, ownerName, visitorTZ, ownerTZ string) map[string]string {
	loc := confirmationLocation(visitorTZ, ownerTZ)
	when := b.StartAt.In(loc).Format("Monday, Jan 2, 2006 · 3:04 PM MST")
	return map[string]string{
		"subject": "Confirmed: " + b.Summary,
		"body":    confirmationText(b, ownerName, when),
		"html":    confirmationHTML(b, ownerName, when, loc),
	}
}

func confirmationText(b *bookingDoc, ownerName, when string) string {
	body := fmt.Sprintf("Hi,\n\nYour meeting is confirmed:\n\n  %s\n  %s\n", b.Summary, when)
	if b.GoogleHTMLLink != "" {
		body += "\nAdd it to your calendar: " + b.GoogleHTMLLink + "\n"
	}
	return body + "\n— sent on behalf of " + ownerName + "\n"
}

func confirmationHTML(b *bookingDoc, ownerName, when string, loc *time.Location) string {
	ld := confirmationJSONLD(b, loc)
	card := confirmationCard(b, ownerName, when)
	return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
		"<script type=\"application/ld+json\">" + ld + "</script></head>" +
		"<body style=\"margin:0;background:#F3EFE6;\">" + card + "</body></html>"
}

func confirmationCard(b *bookingDoc, ownerName, when string) string {
	summary := html.EscapeString(b.Summary)
	whenEsc := html.EscapeString(when)
	link := ""
	if b.GoogleHTMLLink != "" {
		link = "<p style=\"margin:12px 0 0;font:12px monospace;\">" +
			"<a href=\"" + html.EscapeString(b.GoogleHTMLLink) +
			"\" style=\"color:#B5391C;\">open in google calendar →</a></p>"
	}
	return "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">" +
		"<tr><td align=\"center\" style=\"padding:32px 16px;\">" +
		"<table role=\"presentation\" width=\"480\" cellpadding=\"0\" cellspacing=\"0\" " +
		"style=\"background:#fff;border-left:3px solid #B5391C;padding:24px;\">" +
		"<tr><td style=\"font:11px monospace;letter-spacing:0.16em;" +
		"text-transform:uppercase;color:#9b8f80;\">booking confirmed</td></tr>" +
		"<tr><td style=\"font:italic 20px Georgia,serif;color:#1B1814;padding:6px 0 4px;\">" +
		summary + "</td></tr>" +
		"<tr><td style=\"font:13px monospace;color:#1B1814;\">" + whenEsc + "</td></tr>" +
		"<tr><td>" + link + "</td></tr>" +
		"<tr><td style=\"font:11px monospace;color:#9b8f80;padding-top:16px;\">" +
		"— on behalf of " + html.EscapeString(ownerName) + "</td></tr>" +
		"</table></td></tr></table>"
}

type ldVirtualLocation struct {
	Type string `json:"@type"`
	URL  string `json:"url,omitempty"`
}

type ldEvent struct {
	Location  *ldVirtualLocation `json:"location,omitempty"`
	Type      string             `json:"@type"`
	Name      string             `json:"name"`
	StartDate string             `json:"startDate"`
	EndDate   string             `json:"endDate,omitempty"`
	URL       string             `json:"url,omitempty"`
}

type ldReservation struct {
	ReservationFor    ldEvent `json:"reservationFor"`
	Context           string  `json:"@context"`
	Type              string  `json:"@type"`
	ReservationStatus string  `json:"reservationStatus"`
	ReservationNumber string  `json:"reservationNumber"`
}

func confirmationJSONLD(b *bookingDoc, loc *time.Location) string {
	ev := ldEvent{
		Type: "Event", Name: b.Summary,
		StartDate: b.StartAt.In(loc).Format(time.RFC3339),
		EndDate:   b.EndAt.In(loc).Format(time.RFC3339),
		URL:       b.GoogleHTMLLink,
	}
	if b.GoogleHTMLLink != "" {
		ev.Location = &ldVirtualLocation{Type: "VirtualLocation", URL: b.GoogleHTMLLink}
	}
	out, err := json.Marshal(ldReservation{
		Context: "https://schema.org", Type: "EventReservation",
		ReservationStatus: "https://schema.org/ReservationConfirmed",
		ReservationNumber: b.GoogleEventID, ReservationFor: ev,
	})
	if err != nil {
		return "{}"
	}
	return string(out)
}

func confirmationLocation(visitorTZ, ownerTZ string) *time.Location {
	for _, name := range []string{visitorTZ, ownerTZ} {
		if name == "" {
			continue
		}
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
	}
	return time.UTC
}
