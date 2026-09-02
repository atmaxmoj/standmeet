// subject.go —— **whose identity** a session runs as.
//
// Every "N times per X" rule (capability quota) hangs off this. The assembly
// input used to carry only `CodeID` — a name that only understands access
// codes. So the external API-key path had no subject to count against: one key
// could book meetings with zero gating, filling a real calendar as much as it
// wanted (F-B-11).
//
// This type says only "who". "Where the limit is stored" is capconfig's business
// (it has its own Scope) — the two packages don't know each other, and the
// composition root translates between them; see axiscap's quotaScope.

package capreg

// SubjectKind —— the kind of subject. Currently two: an access code, or an
// external API key.
type SubjectKind string

const (
	// SubjectCode —— the path where a visitor comes in holding an access code.
	SubjectCode SubjectKind = "code"
	// SubjectAPIKey —— the path where someone else's program calls in holding an
	// smk_ key.
	SubjectAPIKey SubjectKind = "api_key"
)

// Subject —— the subject's kind plus its id. The two travel together: the id
// alone can't tell you where to look up the limit, since both kinds of id look
// identical (both UUIDs).
type Subject struct {
	Kind SubjectKind
	ID   string
}

// Anonymous —— no subject (public / byoai sessions that have neither a code nor
// a key). These sessions are never usage-gated: they can't even answer "who is
// this", let alone "how many times has this one used it".
func (s Subject) Anonymous() bool { return s.ID == "" }
