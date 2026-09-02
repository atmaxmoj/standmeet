// email.go —— the **storage identity rule** for email: what makes two
// strings count as the same row.
//
// This rule used to live only in `usecase.normalizeEmail`, and that
// function was **only called by change_email**. The claim / login /
// recover entry points all passed the raw value straight through.
// Case got a pass by luck — `owners.email` is citext. **Whitespace does
// not**: citext doesn't trim. Claim a row with a leading space and that
// space-padded string becomes the identity — normal input can never log
// in again after that, and recover can't save it either (same lookup
// path).
//
// So the rule lives in repo instead: email has exactly three doors in and
// out of the database (CreateOwner / UpdateOwnerEmail / GetOwnerByEmail),
// all in this layer. Putting it here means **there is nothing to
// remember** — any new entry point that reads email is automatically
// correct. Putting it in usecase would mean remembering it at every entry
// point, and the person who forgets to call it and the person who writes
// the checker for it are the same person (CLAUDE.md A4: normalize
// foreign data once at the entry point, so downstream always sees a
// well-formed field).
//
// Division of labor: **repo normalizes** (trim + lowercase, deciding
// "is this the same row"), **usecase validates format** (has an @, length,
// deciding "is this acceptable"). citext already handles case; this adds
// the whitespace half.

package repo

import "strings"

// NormalizeEmail —— the form used for storage identity. Exported because
// usecase must also measure against the same yardstick before validating,
// otherwise "the string that passed validation" and "the string that got
// stored" would be two different things.
func NormalizeEmail(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}
