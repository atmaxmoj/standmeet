// Package nativekey holds the native key: a capability credential the backend issues to a fiber so
// it authenticates its privileged reach-back (db bridge, sandbox host_ops). Isolated (a fiber finds
// only its own) and never leaked — the value is reachable ONLY through Reveal(), at the
// reach-back auth boundary and nowhere else. Every ordinary value-escaping channel (fmt, logging,
// JSON, text) redacts to "***", so a stray log or json.Marshal spills stars, not the secret. See
// docs/design/plugin/everything-is-a-block.md (rule 4). A confinement guard keeps Reveal() to the
// auth-boundary package; this redaction is defence in depth for everywhere else.
package nativekey

// redacted —— what every value-escaping channel emits instead of the secret.
const redacted = "***"

// Key —— an issued native key. The underlying string is the credential; only Reveal() unwraps it.
type Key string

// String —— fmt %s / %v (Stringer). Redacted.
func (Key) String() string { return redacted }

// GoString —— fmt %#v (GoStringer). Redacted; %#v would otherwise print the raw string.
func (Key) GoString() string { return "nativekey.Key(" + redacted + ")" }

// MarshalText —— text encoders (and json's TextMarshaler fallback). Redacted.
func (Key) MarshalText() ([]byte, error) { return []byte(redacted), nil }

// MarshalJSON —— encoding/json. Redacted, quoted.
func (Key) MarshalJSON() ([]byte, error) { return []byte(`"` + redacted + `"`), nil }

// Reveal —— the ONLY reader of the real value, for the reach-back auth boundary.
func (k Key) Reveal() string { return string(k) }
