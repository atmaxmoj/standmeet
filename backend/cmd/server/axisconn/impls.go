// impls.go —— this side's implementation of the owner operations a connector
// declares in its manifest.
//
// The declaration and the implementation are kept in two separate places on
// purpose: the declaration is **data** (the connector's own manifest says which
// operation it offers and what it looks like), the implementation wires up through
// the **category contract** (mail.test_send → contract.MailProxy). The generic
// registry therefore knows no category at all; only this table knows any category,
// and this side is exactly where the two plugin axes belong.
//
// A manifest that declares an op not in this table panics at boot (see
// connectorDeclaredOps) — it's never discovered only after the owner clicks it.

package axisconn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// connectorOpImpls —— category contract operation → implementation.
func connectorOpImpls(d *deps.Runtime) map[string]fp.Invoke {
	return map[string]fp.Invoke{
		"mail.test_send": mailTestSend(d),
		"calendar.check": calendarCheck(d),
	}
}

// calendarFailureReason —— a classified sentence, for the owner to read. Same
// discipline as mailFailureReason: every sentence points to the next step, and the
// wording never carries a status code, hostname, or stack trace.
func calendarFailureReason(err error) string {
	switch {
	case errors.Is(err, contract.ErrCalendarNotConnected):
		return "no calendar is connected yet — connect one first"
	case errors.Is(err, contract.ErrCalendarRevoked):
		return "the calendar access was revoked — reconnect it to continue"
	case errors.Is(err, contract.ErrCalendarBadRequest):
		return "the calendar rejected this request — check the booking policy"
	default:
		// covers ErrCalendarUnavailable and anything not yet classified: to the
		// owner they're the same thing — try again in a bit.
		return "couldn't reach the calendar — please try again later"
	}
}

type calendarCheckArgs struct {
	Days int `json:"days"`
}

// calendarCheckOut —— on success, reports **what the calendar actually said**
// (how many days ahead, how many of those slots are busy); on failure, reports one
// plain-language sentence.
//
// Why the receipt carries BusyCount instead of a bare ok: what the owner needs to
// judge is "is this chain still alive right now", and the word "ok" can be answered
// by a local short-circuit too. The count of busy slots can only come from the
// provider's side, which is what makes it a real receipt.
type calendarCheckOut struct {
	Reason string `json:"reason,omitempty"`
	// Summary —— the success sentence, **spoken by this operation itself**. The
	// generic layer would otherwise only know the mail sentence "check your
	// inbox to confirm", which is nonsense for a calendar self-check.
	Summary   string `json:"summary,omitempty"`
	Days      int    `json:"days,omitempty"`
	BusyCount int    `json:"busy_count"`
	OK        bool   `json:"ok"`
}

// checkWindowDays —— how far ahead to look by default. A week is enough to catch
// most people's schedule without slowing the provider down.
const checkWindowDays = 7

// plural —— the receipt needs to read like a sentence. "1 busy blocks" would make
// the owner stop and wonder if something's wrong.
func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// calendarCheck —— asks the calendar for a free/busy window using the stored
// credentials.
//
// **Read-only**: creates no event, changes nothing. One success proves the whole
// chain at once — the credential is real, the token is valid or has been
// transparently refreshed, the scope is enough, the account is reachable. This is
// exactly what the card's "connected" claim asserts and never actually checks.
//
// A failure to reach it is **not** this machine's fault (a revoked grant / a
// provider hiccup both count as normal), so it returns ok:false instead of an error
// — that's the answer the owner actually wants.
func calendarCheck(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in calendarCheckArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		days := checkWindowDays
		if in.Days > 0 {
			days = in.Days
		}
		now := time.Now().UTC()
		busy, ferr := d.ConnectorSlots.Calendar().FreeBusy(ctx, ownerID, contract.FreeBusyReq{
			TimeMin: now, TimeMax: now.AddDate(0, 0, days),
		})
		if ferr != nil {
			// the raw error goes to the log (that's for whoever debugs it); the
			// surface gets the classified sentence.
			d.Log.Warn("connectors.calendar_check", "err", ferr)
			return json.Marshal(calendarCheckOut{OK: false, Reason: calendarFailureReason(ferr)})
		}
		return json.Marshal(calendarCheckOut{
			OK: true, Days: days, BusyCount: len(busy),
			Summary: fmt.Sprintf(
				"The calendar answered — %d busy %s in the next %d days.",
				len(busy), plural(len(busy), "block", "blocks"), days,
			),
		})
	}
}

// mailFailureReason —— a classified sentence, for the owner to read.
//
// **Every sentence has to point to a next step**: fix the config / change the
// recipient / try again in a bit. The wording never carries a status code,
// hostname, or stack trace — those mean nothing to the owner, and this message gets
// rendered all the way to the browser.
func mailFailureReason(err error) string {
	switch {
	case errors.Is(err, consumer.ErrMailNotConfigured):
		return "no mail connector is set up yet — connect one first"
	case errors.Is(err, contract.ErrMailRejected):
		return "the mail provider rejected this message — check the recipient address"
	default:
		// covers ErrMailUnavailable, and anything not yet classified: both are
		// the same thing to the owner — nothing he can fix, try again later.
		return "couldn't reach the mail provider — please try again later"
	}
}

type mailTestSendArgs struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
}

// mailTestSentOut —— on a successful send, reports which mail kind delivered it
// (proving the send path doesn't care about the kind); on failure, reports one
// **plain-language reason**.
//
// Reason didn't used to exist: a failed send only returned {ok:false}. The owner
// clicks "send a test email", and the panel can only show "failed" — is SMTP
// unreachable, are the credentials expired, or did the recipient reject that
// address? He can't tell, and so doesn't know what to fix. A diagnostic button that
// gives no diagnosis just tells him what he already knew.
//
// The reason is a **classified sentence**, not the provider's raw error leaking
// through: that raw text carries a status code, a hostname, sometimes a stack trace
// — meaningless to the owner, but intelligence to an onlooker.
type mailTestSentOut struct {
	ViaKind string `json:"via_kind,omitempty"`
	Reason  string `json:"reason,omitempty"`
	// MessageID —— the id the provider issued for this message (F-C-55). **Empty
	// is itself an answer**: the SMTP path can't produce one. With it, the owner
	// can go match this exact message in the provider's own logs, instead of
	// only knowing "no error was reported".
	MessageID string `json:"message_id,omitempty"`
	OK        bool   `json:"ok"`
}

// mailTestSend —— sends a test email through the currently active mail connector.
//
// A failed send is **not** this machine's fault (SMTP being down / bad credentials
// both count as normal), so it returns ok:false instead of an error — that's the
// answer the owner actually wants.
func mailTestSend(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in mailTestSendArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"to", in.To}); err != nil {
			return nil, err
		}
		rcpt, serr := d.ConnectorSlots.Mail().Send(ctx, ownerID,
			contract.MailMessage{To: in.To, Subject: in.Subject, Body: in.Text})
		if serr != nil {
			// the raw error goes to the log (not what the owner needs, but what
			// whoever debugs it needs); the surface gets the classified sentence.
			d.Log.Warn("connectors.mail_test_send", "err", serr)
			return json.Marshal(mailTestSentOut{OK: false, Reason: mailFailureReason(serr)})
		}
		return json.Marshal(mailTestSentOut{
			OK: true, ViaKind: d.ConnectorSlots.MailKind(ctx, ownerID),
			MessageID: rcpt.ProviderID,
		})
	}
}
