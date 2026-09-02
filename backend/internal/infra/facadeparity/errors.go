// errors.go — the gate sorts errors into a few **protocol-agnostic categories**; the concrete
// shape is each facade's own business.
//
// Category table:
//
//	BadInput  caller's input is wrong       → HTTP 400 / MCP isError
//	Unauthed  this identity no longer valid → HTTP 401 / MCP isError (frontend redirects to login)
//	NotFound  the requested thing is gone   → HTTP 404 / MCP isError
//	Forbidden this action isn't allowed here → HTTP 403 / MCP isError
//	Conflict  conflicts with existing state → HTTP 409 / MCP isError
//	Upstream  a dependency failed           → HTTP 502 / MCP isError (message is safe to show)
//	other     this machine broke            → HTTP 500 (logged, not exposed) / MCP isError
//
// The gate doesn't know status codes, doesn't know isError. It only states which category;
// translation is left to the facade.
//
// Why this exists: once the admin facade moved validation from the handler into the gate, the
// handler still had to return 400/404/409 instead of a blanket 500. Without this distinction,
// both sides would keep their own error taxonomy — exactly the duplication the gate exists to
// eliminate.
//
// **The bar for adding a category is "does a facade behave differently because of it", not
// "does the wording differ".** 409 is a real category: the frontend branches on status (401 →
// redirect to login / 409 → handle in place / everything else → generic toast); collapsing it
// into 400 would change that behavior. 502 too: it carries a message safe to show directly
// ("couldn't fetch this skill, check the source"), and collapsing it into 500 turns it into
// "internal error". Conversely, "mail connector isn't configured" vs. "missing required field"
// behave identically for every facade — that's **message content**, not a new category. Every
// category added means every facade has to add a matching translation.

package facadeparity

import (
	"errors"
	"fmt"
)

// badInputError —— the caller's input is wrong (missing required field, bad format, id doesn't
// exist, that kind of thing).
type badInputError struct{ msg string }

func (e badInputError) Error() string { return e.msg }

// BadInput —— make a "caller got it wrong" error. The message faces the caller directly and
// must be understandable.
func BadInput(msg string) error { return badInputError{msg: msg} }

// IsBadInput —— is this error the caller's fault? The facade picks its status code off this.
func IsBadInput(err error) bool {
	var t badInputError
	return errors.As(err, &t)
}

// notFoundError —— the thing being operated on doesn't exist (id doesn't match, already deleted).
type notFoundError struct{ msg string }

func (e notFoundError) Error() string { return e.msg }

// NotFound —— make a "not found" error. The message faces the caller directly.
func NotFound(msg string) error { return notFoundError{msg: msg} }

// IsNotFound —— the facade returns 404 off this, instead of 400/500.
func IsNotFound(err error) bool {
	var t notFoundError
	return errors.As(err, &t)
}

// conflictError —— conflicts with state that already exists (duplicate name, already installed,
// that kind of thing).
type conflictError struct{ msg string }

func (e conflictError) Error() string { return e.msg }

// Conflict —— make a "conflicts with current state" error. The frontend handles 409 in place,
// not through the generic toast.
func Conflict(msg string) error { return conflictError{msg: msg} }

// IsConflict —— the facade returns 409 off this.
func IsConflict(err error) bool {
	var t conflictError
	return errors.As(err, &t)
}

// unauthedError —— this request's identity no longer holds (the session's owner no longer
// exists, that kind of thing). The difference from Forbidden: Forbidden says "I recognize who
// you are, but this action isn't allowed"; this one says "I no longer recognize who you are".
// The frontend redirects to login on 401, so it must stay separate from 403.
type unauthedError struct{ msg string }

func (e unauthedError) Error() string { return e.msg }

// Unauthed —— make an "identity no longer valid" error.
func Unauthed(msg string) error { return unauthedError{msg: msg} }

// IsUnauthed —— the facade returns 401 off this (not 403/404).
func IsUnauthed(err error) bool {
	var t unauthedError
	return errors.As(err, &t)
}

// forbiddenError —— nothing wrong with the request, the thing exists too, but this action isn't
// allowed on it (built-in items that can't be edited/deleted). The difference from BadInput is
// it isn't "you wrote it wrong"; the difference from NotFound is the thing genuinely exists —
// the facade returns 403.
type forbiddenError struct{ msg string }

func (e forbiddenError) Error() string { return e.msg }

// Forbidden —— make a "not allowed to do this" error.
func Forbidden(msg string) error { return forbiddenError{msg: msg} }

// IsForbidden —— the facade returns 403 off this.
func IsForbidden(err error) bool {
	var t forbiddenError
	return errors.As(err, &t)
}

// upstreamError —— an external service we depend on failed (couldn't fetch a remote skill,
// upstream timeout). The message is written for a human and can be surfaced as-is — it
// describes not our internals but "the other side is down".
type upstreamError struct{ msg string }

func (e upstreamError) Error() string { return e.msg }

// Upstream —— make an "external dependency failed" error.
func Upstream(msg string) error { return upstreamError{msg: msg} }

// IsUpstream —— the facade returns 502 off this, and surfaces the message (unlike 500, which
// hides it).
func IsUpstream(err error) bool {
	var t upstreamError
	return errors.As(err, &t)
}

// OpErr —— the uniform wrap for every op: states which step broke while keeping errors.Is
// working (a domain translates its own sentinel into one of the categories above; one layer of
// wrapping must not block that).
func OpErr(what string, err error) error {
	return fmt.Errorf("%s: %w", what, err)
}

// RequireArgs —— reports whichever required field is missing. This layer only checks
// "was it given"; whether a given value is actually valid (format, enum, existence) is the
// domain's own call.
func RequireArgs(pairs ...[2]string) error {
	for _, p := range pairs {
		if p[1] == "" {
			return BadInput(p[0] + " is required")
		}
	}
	return nil
}
