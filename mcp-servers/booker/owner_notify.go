// owner_notify.go —— #130: per-code "notify owner on a successful booking", re-homed into
// the sandbox.
//
// After a visitor books successfully, if that code has the notify switch on, send
// **the owner themself** an owner-facing email (distinct from #122's confirmation
// email to the visitor). No AI involved: fires deterministically after booking commit
// succeeds.
//
// Why it lives here: when #135 externalized booker, it deleted the host-side
// booking_owner_notify.go, and the commit message noted its own gap: "owner-notify
// (#130) not yet re-homed into the sandbox" — so this feature just dropped, and two
// e2e specs stayed red ever since. A capability's own state belongs to the capability:
// the switch already lives in booker's own capstore (the role snapshot's switch comes
// through via `_meta`), the recipient comes from owner.meta, and sending goes through
// connector.invoke("mail","send") — the same path as the confirmation email, so the
// kernel doesn't need to learn "booking notify" as a new concept.
//
// **best-effort**: switch off / no mail connector configured / send failure all just
// mean no notification — they must never fail the booking itself (the booking is
// already persisted and the calendar event already created; rolling that back over a
// notification email would be backwards).

package main

import "encoding/json"

// notifyOwnerOfBooking —— sends the owner a notification after a booking succeeds.
// **Async**: the booking already succeeded, so a notification email must never hang
// the tool call (the visitor is watching the card, waiting). Sending runs in the
// background, with budgeted retry on transient transport errors.
// Never returns an error: the call site is after the booking already succeeded, so
// any failure here only affects this one email.
func notifyOwnerOfBooking(s session, b *bookingDoc) {
	if !s.NotifyOwner {
		return
	}
	if err := sendOwnerNotify(s, b); err != nil {
		_ = err // best-effort: booking already succeeded, a notify failure doesn't roll it back
	}
}

// sendOwnerNotify —— composes the message and hands it to the host for background delivery
// (with retry).
func sendOwnerNotify(s session, b *bookingDoc) error {
	to, err := gwOwnerMeta(s.OwnerID, "email")
	if err != nil {
		return err
	}
	if to == "" {
		return nil // owner has no deliverable address, retrying wouldn't help
	}
	ownerTZ, _ := gwOwnerMeta(s.OwnerID, "timezone")
	msg := buildOwnerNotifyEmail(b, s.VisitorName, ownerTZ)
	msg["to"] = to
	payload, merr := json.Marshal(msg)
	if merr != nil {
		return merr
	}
	return gwConnectorInvokeBackground(s.OwnerID, "mail", "send", payload)
}

// buildOwnerNotifyEmail —— owner's-eye view: who, when, and what got booked. Time renders
// in the owner's own timezone (the recipient is the owner, not the visitor).
func buildOwnerNotifyEmail(b *bookingDoc, visitorName, ownerTZ string) map[string]string {
	loc := confirmationLocation("", ownerTZ) // empty visitor tz → falls back to owner tz, then UTC
	when := b.StartAt.In(loc).Format("Monday, Jan 2, 2006 · 3:04 PM MST")
	who := visitorName
	if who == "" {
		who = "A visitor"
	}
	body := "New booking on your calendar:\n\n  " + b.Summary +
		"\n  with " + who + "\n  " + when + "\n"
	// The key name must match contract.MailMessage's json tag: body (not text). A wrong
	// key gets silently dropped — the email still sends with a blank body, and "it sent"
	// looks completely normal.
	return map[string]string{
		"subject": "New booking: " + b.Summary,
		"body":    body,
	}
}
