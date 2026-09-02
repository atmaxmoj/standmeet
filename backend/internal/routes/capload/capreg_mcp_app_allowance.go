// capreg_mcp_app_allowance.go —— what this capability tells the model when its allowance
// runs out.
//
// F-B-14 (actually happened in prod): once quota is spent, the host **hides this capability
// entirely**, and its instructions never ask the gate — so that turn's agent reads "you can
// book meetings" while holding no such tool, **with not one sentence explaining what
// happened**. "This tool never existed" and "the allowance ran out" are the same evidence
// from the model's point of view, and its most natural fix for that evidence is to doubt
// its own just-produced output: in front of the visitor, it recast two **real** meetings as
// "actually never booked, no invite ever sent" — while those two meetings sat fine on the
// owner's calendar the whole time.
//
// Hiding the tool is correct (never let the model see a tool it can't use); **silence is not
// an answer**. The same issue was already fixed once on the HTTP side today: when quota is
// spent it returns 429 `quota_exhausted` instead of "you never had this capability"
// (F-B-11). The session side still owed the other half — API callers don't need it, but
// visitors do: **what's already been done still counts**.
//
// The host doesn't know what "booking" is: this sentence is phrased using the capability's
// own Title, so it holds for any other capability too.

package capload

import (
	"context"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// SessionNote —— capreg.SessionNoter: the sentence this capability must say in this session,
// no matter what.
//
// This route exists instead of just editing the instructions because **the visitor's system
// prompt is frozen at session start** (assembled client-side and sent back as-is). A fact
// that only becomes true mid-session can only get in through each turn's instruction — that
// is exactly why this interface exists, and exactly why the F-B-14 sentence never reached the
// model in the first place.
func (c *mcpAppCapability) SessionNote(
	ctx context.Context, in *capreg.AssembleInput,
) string {
	return c.spentAllowanceNote(ctx, in)
}

// spentAllowanceNote —— when the allowance is spent, the sentence said **in place of** this
// capability's instructions. Empty = not spent, send the instructions as usual.
func (c *mcpAppCapability) spentAllowanceNote(
	ctx context.Context, in *capreg.AssembleInput,
) string {
	if !c.quotaSpent(ctx, in) {
		return ""
	}
	return "This visitor has used up their allowance for " + c.allowanceLabel() +
		" on this access code, so that tool is not available for the rest of this session. " +
		"Anything already done with it stands — it really happened and the results are real, " +
		"and you must not suggest otherwise. Say plainly that no more are available on this " +
		"code, and point them at the owner if they need another."
}

// quotaSpent —— whether the gate hid this capability **because the allowance ran out**. No
// gate attached / hidden for some other reason → false.
//
// This asks the same gate (the same count), not a second computation: if the two places
// computed it separately, what the instructions say and what the tool table does would
// eventually drift apart — and that drift is exactly the moment this bug happens.
func (c *mcpAppCapability) quotaSpent(ctx context.Context, in *capreg.AssembleInput) bool {
	if c.gate == nil {
		return false
	}
	ok, err := c.gate(ctx, in)
	return !ok && errors.Is(err, capreg.ErrQuotaExhausted)
}

// allowanceLabel —— what to call this capability in the sentence. Title is the human-facing
// name; if there is none, fall back to id rather than leaving a hole ("used up their
// allowance for  on this access code").
func (c *mcpAppCapability) allowanceLabel() string {
	if c.m.Title != "" {
		return c.m.Title
	}
	return c.m.ID
}
