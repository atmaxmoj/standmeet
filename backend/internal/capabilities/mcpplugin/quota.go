// quota.go —— a capability's per-subject usage cap, **declared as data**.
//
// "This code can book at most twice" is made of three facts: where the cap lives
// (which config field on the subject), how usage is counted (which collection in
// the capability's own storage), and how a document is recognized as belonging to
// this subject (which field). All three are this capability's own knowledge, so it
// states them itself.
//
// **A subject isn't only a code**: a visitor comes in holding a code, someone
// else's program calls in holding an external key — both are the X in "how many
// per X". This declaration only names the field, not which kind of subject it is.
//
// With these three lines the host implements two things generically, off one
// count:
//
//   - Gate: hits the cap → this tool isn't exposed for this session (hidden,
//     rather than letting the visitor click it and then get an error).
//   - Remaining: fills "how many left" into capability_state for the frontend to
//     display.
//
// These two hooks used to be hand-written at the composition root, spelling out
// "bookings", "code_id", "max_bookings" right there in the code — the kernel
// doesn't know what a booking is, but the composition root did. And it already cost
// a lesson once: when booker got externalized (#135), both hooks were removed
// together, and only the gate was ever restored — remaining has been nil ever
// since, while the frontend contract still promises that field. Sharing one
// declaration for both means only half never gets restored again.

package mcpplugin

// QuotaDecl —— the declaration of a per-**subject** usage cap. The subject is an
// access code, or possibly an external API key.
type QuotaDecl struct {
	// ConfigKey —— which key in this subject's config the cap value comes from
	// (e.g. "max_bookings"). Unset / null / <= 0 → unlimited.
	ConfigKey string
	// Collection —— which collection in this capability's own storage usage is
	// counted from (e.g. "bookings").
	Collection string
	// SubjectField —— which field in those documents records the **subject**
	// (e.g. "subject_id").
	//
	// This field used to be called `CodeField`, valued `"code_id"` — a name that
	// only recognized codes. So rows written down the external-API-key path had
	// no countable subject, and quota never counted them at all (F-B-11). After
	// renaming it to subject, "who it's attached to" finally became a real
	// parameter ([[names-that-lie]]).
	SubjectField string
}

// Usable —— can this declaration actually be enforced. All three lines must be
// present: missing even one and the host can't count usage, and then "don't gate"
// beats "gate blindly". A nil receiver is legal (most capabilities don't gate usage).
func (q *QuotaDecl) Usable() bool {
	return q != nil && q.ConfigKey != "" && q.Collection != "" && q.SubjectField != ""
}
