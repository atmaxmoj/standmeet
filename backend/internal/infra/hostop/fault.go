// fault.go — the **category** of one host op failure, carried across the socket alongside
// the receipt.
//
// Why it's needed: the sandbox has no network, so every callback it makes to the host only
// gets back `{"error":"<one sentence>"}`. **One sentence is not a category** — the sandbox
// side can only treat every failure as the same kind, so "owner hasn't configured mail" and
// "the mail connector can't be reached right now" come out as the same sentence on the
// visitor's screen, and one of those sentences is false (F-C-42).
//
// The host already distinguishes them (the `connector` domain has `errNoActiveConnector` →
// `ErrMailNotConfigured`); the place the category gets lost is **the boundary**. So the fix
// goes at the boundary: the error carries a code across, and the sandbox branches on the code.
//
// The code is **a stable vocabulary for the sandbox**, not a sentence for a human — the
// sentence still lives in Error(), and its wording can change anytime without breaking the
// sandbox's branch ([[collapsed-error-class-kills-its-own-branch]]).

package hostop

// A fixed vocabulary. Before adding an entry, ask: **would the sandbox act differently on it?**
// If you just want more detail, that belongs in the Error() sentence, not here.
const (
	// FaultNotConfigured — the owner hasn't configured this (no active connector).
	// The sandbox can use it to say "this path isn't set up yet".
	FaultNotConfigured = "not_configured"
	// FaultUnavailable — it's configured, but can't be done right now (unreachable, rejected,
	// timed out). The sandbox should say "can't do this right now, try again later" —
	// **must not** say it was never configured.
	FaultUnavailable = "unavailable"
)

// FaultError — a host op error carrying a category.
type FaultError struct {
	Err  error
	Code string
}

func (f *FaultError) Error() string { return f.Err.Error() }

func (f *FaultError) Unwrap() error { return f.Err }

// FaultCode — the transport layer recognizes it by **method**, not by type.
// The socket layer is a strict leaf (`capsocket: mayDependOn: []` in `.go-arch-lint.yml`) —
// it isn't even allowed to import this package; with this method, it only needs to declare
// a local interface of the same shape.
func (f *FaultError) FaultCode() string { return f.Code }
