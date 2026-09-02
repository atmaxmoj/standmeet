// visitor_profile.go — a visitor's self-declared identity (profile).

package entity

// VisitorProfile — the self-declared identity a visitor fills in / carries on entry.
// Attached to the session (the visitor identity), not to chat — one person carries the
// same profile across multiple conversations.
//
//   - Name  —— the name the owner sees in the transcript (a handle works too).
//   - Email —— optional. booker uses it as the fallback visitor_email for calendar_book
//     (so Google can still send an invite even when the AI never asked for it in
//     conversation), and it's also the default recipient for confirmation emails.
//     Empty = not filled in.
//
// Visitor timezone (#120) and similar future fields also belong on this profile.
type VisitorProfile struct {
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}
