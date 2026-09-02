// errors.go —— calendar-connector sentinel errors (#190). These are CONNECTOR-category outcomes
// (owner hasn't connected / oauth revoked / upstream 5xx / bad request / SSRF-blocked egress), not
// booking-domain concepts — so they live with the connector contract, consumed by the connector
// adapters + the capability plugins that call the calendar proxy. Moved out of the kernel domain.

package contract

import "errors"

// ErrCalendarNotConnected —— the owner hasn't finished OAuth / hasn't connected a calendar.
var ErrCalendarNotConnected = errors.New("calendar connector not connected")

// ErrCalendarRevoked —— the refresh_token is invalid (the user revoked it on Google's side).
var ErrCalendarRevoked = errors.New("calendar oauth revoked")

// ErrCalendarUnavailable —— the calendar service is transiently unavailable (5xx / network
// jitter) and the retry budget is exhausted.
var ErrCalendarUnavailable = errors.New("calendar temporarily unavailable")

// ErrCalendarBadRequest —— the request itself is invalid (pre-flight: the body the binding
// built is missing required fields, etc).
var ErrCalendarBadRequest = errors.New("calendar request invalid")

// ErrCalendarBlockedEgress —— the connector's outbound target resolves inside the private
// network (blocked by the SSRF guard). The message is fixed and clean (it never echoes the
// blocked internal URL, to keep metadata-endpoint paths from leaking).
var ErrCalendarBlockedEgress = errors.New(
	"calendar connector blocked: target resolves to an internal/private address",
)

// The mail-side counterpart. Calendar already had this classification; mail didn't — so a
// send failure could only propagate the provider's error verbatim (status codes, hostnames,
// sometimes a stack trace, all in there). The surface then had to either dump the whole thing
// (meaningless to the owner, intel to an onlooker) or swallow it whole (just says "failed",
// giving the owner nothing to act on). Classifying it opens a third option: say one thing the
// owner can actually fix.

// ErrMailUnavailable —— the sender is temporarily unavailable (5xx / network jitter / retry
// budget exhausted). The owner doesn't need to change any configuration.
var ErrMailUnavailable = errors.New("mail provider temporarily unavailable")

// ErrMailRejected —— the sender refused this particular message (4xx: invalid address,
// blocklisted, content rejected). It's a problem with **this message**, not the connection.
var ErrMailRejected = errors.New("mail provider rejected the message")
