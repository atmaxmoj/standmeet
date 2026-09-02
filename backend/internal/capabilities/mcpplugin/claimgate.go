// claimgate.go —— a capability can declare: **what I do either happened or it
// didn't; just saying so doesn't count**.
//
// Where F-A-37 came from: in the real environment, after four booking rounds in a
// row, the fifth request got answered with *"Booked. ✅ Monday, August 31 ·
// 13:00–13:30 UTC … Invite went to …"*, while that turn **called no tool at all** —
// the real calendar was empty all day. The history the browser replays to the model
// is only `{role, content}` — what it read back were four "Booked" lines it wrote
// itself, with no trace of any tool call, so what got completed was **that
// sentence**, not that action.
//
// A prompt saying "don't make things up" can't stop this on its own: that's a
// probability, not a mechanism. This declaration turns it into a **necessary
// condition** the host enforces — when the answer contains an "already done" kind
// of statement, this turn must carry that tool's success receipt, or the host rules
// the turn invalid (the `ClaimUnbacked` stop reason), and the visitor gets the
// product's own words instead of the model's.
//
// The host only reads these two fields and never knows what "booking" is; the next
// capability doing an "already sent / submitted / ordered" kind of action gets the
// same gate by copying these two lines.

package mcpplugin

import "strings"

// ClaimGateDecl —— a capability's declaration of "said it, so must have done it".
// nil = this capability doesn't gate claims.
type ClaimGateDecl struct {
	// Tool —— the tool name backing this kind of claim. A success receipt for
	// this tool this turn = the claim is grounded.
	Tool string
	// Phrases —— phrasings that assert "the action is already done" (lowercase
	// substring match).
	//
	// **Keep it narrow**: only take completed-state assertions. A proposal ("shall
	// I book"), a question, a refusal are none of them claims — a gate that
	// wrongly kills a normal answer costs more than the lie it would have blocked,
	// so err toward missing some rather than over-triggering.
	Phrases []string
}

// Usable —— can this declaration actually be enforced: missing the tool name or
// having no phrases at all means it can't be judged, and then "don't gate" beats
// "gate blindly". A nil receiver is legal (most capabilities don't gate claims).
func (c *ClaimGateDecl) Usable() bool {
	return c != nil && c.Tool != "" && len(c.Phrases) > 0
}

// Claims —— does this answer assert the action is already done. Case-insensitive;
// an empty answer is never a claim.
func (c *ClaimGateDecl) Claims(answer string) bool {
	if !c.Usable() {
		return false
	}
	low := strings.ToLower(answer)
	for _, p := range c.Phrases {
		if p != "" && strings.Contains(low, strings.ToLower(p)) {
			return true
		}
	}
	return false
}
