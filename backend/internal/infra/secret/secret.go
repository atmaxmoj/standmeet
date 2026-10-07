// Package secret —— a plaintext credential that cannot be printed by accident.
//
// A provider API key unsealed from the vault (or brought by a BYOAI visitor) has to exist in memory
// as plaintext for the one call that uses it. As a bare string it also comes out of every `%v`,
// `%+v`, wrapped error, JSON dump and slog attribute of whatever struct carries it — one careless
// log line and the key is in the logs (refactor ledger R5, 2026-10-06). String renders as
// "[redacted]" through all of those; the key is reachable only by calling Reveal, at the one place
// that hands it to the provider.
package secret

import "log/slog"

// String —— a plaintext secret. The zero value is "no secret".
type String struct{ v string }

const redacted = "[redacted]"

// New —— wrap a plaintext secret.
func New(s string) String { return String{v: s} }

// Reveal —— the plaintext, for the call that needs it. Never log the result.
func (s String) Reveal() string { return s.v }

// Empty —— no secret set.
func (s String) Empty() bool { return s.v == "" }

// String —— fmt's %v / %s / %+v.
func (String) String() string { return redacted }

// GoString —— fmt's %#v.
func (String) GoString() string { return redacted }

// MarshalJSON —— encoding/json and slog's JSON handler.
func (String) MarshalJSON() ([]byte, error) { return []byte(`"` + redacted + `"`), nil }

// LogValue —— slog attributes.
func (String) LogValue() slog.Value { return slog.StringValue(redacted) }
