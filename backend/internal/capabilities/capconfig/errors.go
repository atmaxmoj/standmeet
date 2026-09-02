package capconfig

import "errors"

// ErrUnknownField — the caller wrote a config key the declaration doesn't have.
// This is the caller's fault, not the host's.
var ErrUnknownField = errors.New("capconfig: field is not declared by this capability")

// ErrInvalidValue — the value doesn't match the declaration (wrong type, out of
// range, wrong format). The caller's fault.
var ErrInvalidValue = errors.New("capconfig: value does not match the declared field")

// ErrNoScope — a write was attempted with no subject to attach to (empty owner /
// empty code). Reads may return empty; writes may not.
var ErrNoScope = errors.New("capconfig: no scope to write the configuration to")

// ErrFieldTaken — two capabilities claim the same field name on an invitation
// code. There's no right answer for who owns the write and who owns the read
// back — this must fail at startup, not surface later as "the owner's setting
// silently didn't take effect".
var ErrFieldTaken = errors.New("capconfig: two capabilities claim the same code field")
