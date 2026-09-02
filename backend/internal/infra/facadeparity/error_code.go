// error_code.go —— attaches a **stable, machine-readable code** to an already-categorized error.
//
// The category decides the status code (see errors.go); the code is a separate thing: a string
// the caller branches on for specific handling, part of an already-shipped contract. The two
// aren't the same thing —
//
//	Conflict            → 409, default code "conflict"
//	Coded(Conflict, …)  → 409, code "role_name_taken"
//
// Why they're kept separate: during a migration I collapsed role's role_name_taken /
// role_builtin_immutable into the category defaults conflict / forbidden. The status code stayed
// the same, but **the payload said less** — what the frontend got degraded from "name is taken"
// to "conflict". Category is for the facade to pick a status code; code is for the caller to
// branch on. Neither can substitute for the other.
//
// No need to write one when the default code is good enough: only pin a code explicitly when
// "this code is an already-shipped contract".

package facadeparity

import "errors"

// codedError —— a layer wrapped around a categorized error that adds just a code.
// Implements Unwrap, so IsBadInput / IsNotFound / … still recognize the category inside as usual.
type codedError struct {
	inner error
	code  string
}

func (e codedError) Error() string { return e.inner.Error() }
func (e codedError) Unwrap() error { return e.inner }

// Coded —— pin a machine-readable code onto an already-categorized error.
func Coded(err error, code string) error { return codedError{inner: err, code: code} }

// CodeOf —— retrieve an explicitly pinned code. Not pinned → ok=false, facade uses the category's
// default code.
func CodeOf(err error) (string, bool) {
	var t codedError
	if errors.As(err, &t) {
		return t.code, true
	}
	return "", false
}
