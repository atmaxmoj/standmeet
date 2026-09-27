// outbound.go — the core's neutral outbound port for sending **deterministic** notices
// (recovery, and delivering an access code to a requester when a gate request is
// approved).
//
// The core's side only sees this one interface: one recipient, one subject, one body.
// It doesn't know whether the other side is email, IM, or something else; **this package
// contains neither the word "mail" nor "SMTP"** (aside from this comment itself).
//
// What's wired up behind it is decided by the **composition root**, and the wiring
// itself is neutral too: `cmd/server/port/outbound_sender.go` binds it to the registry's
// `Invoke(category, verb, argsJSON)` — not to some typed category proxy. The difference
// is compile-time: if the core could write `proxy.Send(...)` against a typed mail
// interface, it would know about "sending mail" and that a message is made of
// To/Subject/Body/HTML — the name would be gone but the shape would remain. As it
// stands, this interface is the only thing it can write.

package usecase

import (
	"context"
	"errors"
)

// ErrOutboundNotConfigured — the owner hasn't set up a working outbound channel yet;
// delivery is impossible.
//
// **The core's own sentinel.** This used to be `consumer.ErrMailNotConfigured` exported
// from the supplier side — a boundary-crossing error with "mail" in its name: the
// moment the core did errors.Is against it even once, that was an admission that it
// knows the other side is email. The composition root is responsible for translating
// the channel-side equivalent into this one (see cmd/server/port/outbound_sender.go).
var ErrOutboundNotConfigured = errors.New("no outbound channel configured")

// OutboundSender — the neutral port for sending one deterministic notice **synchronously**. Not
// configured/not connected -> ErrOutboundNotConfigured.
//
// Only the recovery phrase sends through it (by decision, #3: the owner waits on the login page
// and must learn on the spot whether the phrase went out). Every other mail is a durable job whose
// send port only subscribers hold; use cases get OutboundStatus to ask whether mail can go at all.
type OutboundSender interface {
	OutboundStatus
	// Send — delivers one notice to a recipient.
	Send(ctx context.Context, ownerID string, n OutboundNotice) error
}

// OutboundStatus — the read half: can a notice go out at all, and what the owner connects so it
// can. A question, not a side effect.
type OutboundStatus interface {
	// Connected — whether the outbound channel is available (owner configured it and it
	// verified).
	Connected(ctx context.Context, ownerID string) (bool, error)
	// ChannelName — when delivery fails, tells the owner **which kind** of supplier to
	// go connect.
	//
	// This string is supplied by the **composition root** (only it knows which category
	// this instance's outbound is bound to); the core just relays it. Before this field
	// existed, the message said "an outbound channel" — a phrase that appears nowhere in
	// the UI: the owner would read it and have no idea where to go or what to look for.
	// **A noun in an error message must be one the owner can actually find on screen.**
	ChannelName() string
}

// OutboundNotice — one notice waiting to be sent. **This is the entirety of what the
// core can express**: who to send it to, one title line, one body.
//
// All three fields are **channel-agnostic**: email treats Title as the subject line, IM
// as the first line, push as the notification title. There used to be an `HTML` field
// here too (email's text/html alternative), which is a concept **only email has** — and
// no caller had ever filled it in. Its only function was letting the core still be able
// to write "an email". It's gone now.
type OutboundNotice struct {
	// To — the recipient's address on that channel. The core never parses it and doesn't
	// know whether it's an email address or something else.
	To string
	// Title — a one-line title.
	Title string
	// Body — the plain-text body.
	Body string
}
