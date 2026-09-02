// Package ops — what the access domain can do outward, declared by the domain itself.
//
// One operation is a complete unit here: id, description, input schema, semantic kind, exposure
// intent, implementation. ops.go itself only holds the few small pieces reused across
// declarations.
package ops

import (
	"encoding/json"
	"time"
)

// noArgs — an operation that takes no arguments.
var noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// nonNilStrings — a nil slice serializes to null; the caller wants [].
func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

// formatOptionalTime — nil stays null (the caller uses that to display "none").
func formatOptionalTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
