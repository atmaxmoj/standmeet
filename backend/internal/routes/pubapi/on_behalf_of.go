// on_behalf_of.go — "who this call is acting on behalf of."
//
// On the visitor path this is answered by the identity modal: name and email are **filled in
// by the visitor themselves**, never picked by the model from the conversation — F-B-6 is what
// happens when the model picks: it invents an address that was never spoken and then claims in
// chat that it already sent to it. So the invitee can only come from the session identity;
// `calendar_book` does not accept this as a tool arg.
//
// The key path has no modal: the caller is someone else's program. **That's exactly the missing
// slot** — every meeting booked through the facade ends up with zero attendees, and the owner
// shows up to an empty room at the scheduled time (F-B-12). The fix isn't adding a tool arg
// (that would reopen F-B-6); it's having the caller state who it's acting on behalf of at the
// **request layer**, with zero changes needed on the plugin side.
//
// Omission is explicit: no headers = a hold that belongs only to the owner, and the receipt's
// `invited_email` is an empty string that says so plainly. A header that's present but doesn't
// look like an address → 400, never silently treated as absent — that one line is exactly what
// separates "I thought I invited someone" from "the product knows I didn't."

package pubapi

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"
)

const (
	// headerVisitorEmail —— who this meeting is booked for: the meeting's guest.
	headerVisitorEmail = "X-Standmeet-Visitor-Email"
	// headerVisitorName —— that person's name (optional, only feeds display spots like the
	// calendar title).
	headerVisitorName = "X-Standmeet-Visitor-Name"
	// maxVisitorNameLen —— the name goes into the calendar event title, so cap it to keep one
	// call from turning the title into an essay.
	maxVisitorNameLen = 120
)

var errBadVisitorEmail = errors.New(
	"X-Standmeet-Visitor-Email must be an email address — omit the header to book without a guest")

// visitorHeader —— the two fields read off the headers. **Local type, does not import the
// domain**: a route must not connect directly to a domain facade (check-routes-via-dispatcher),
// and this step is just HTTP parsing anyway — folding it into a domain identity is the caller's
// job.
type visitorHeader struct {
	Name  string
	Email string
}

// onBehalfOf —— reads who this call is acting on behalf of from the request headers. Neither
// header present → empty identity (valid).
func onBehalfOf(r *http.Request) (visitorHeader, error) {
	email := strings.TrimSpace(r.Header.Get(headerVisitorEmail))
	name := strings.TrimSpace(r.Header.Get(headerVisitorName))
	if email == "" {
		return visitorHeader{Name: truncateName(name)}, nil
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return visitorHeader{}, errBadVisitorEmail
	}
	return visitorHeader{Name: truncateName(name), Email: email}, nil
}

func truncateName(name string) string {
	if len(name) <= maxVisitorNameLen {
		return name
	}
	return name[:maxVisitorNameLen]
}
