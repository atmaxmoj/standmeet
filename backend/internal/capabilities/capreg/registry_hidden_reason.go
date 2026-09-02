// registry_hidden_reason.go —— "why isn't this tool in this session".
//
// Hiding it is correct; **not saying why** is the actual problem, and it's only a
// problem on one face:
//
//   - Chat face: it's enough that the model can't see the tool. Saying more would
//     make it relay a limitation to the visitor that isn't the model's to explain.
//   - HTTP face: the caller is a program that **named this exact tool**. "Your key
//     never had this capability" and "your quota ran out" call for opposite
//     actions (go ask the owner for access / wait or top up), yet before this both
//     returned the same `capability_not_enabled`
//     (F-B-11, [[collapsed-error-class-kills-its-own-branch]]).
//
// Only asked once, **when the caller can't otherwise answer**: the successful
// assembly path never reaches this, so it adds no cost to the hot path.

package capreg

import (
	"context"
	"fmt"
	"slices"
)

// HiddenReasonForTool —— for the capability that declares this tool, why it
// didn't show up in this session.
//
// Returns nil to mean "no reason to give": either no capability declares this
// name, or it's actually present and fine. The caller falls back to the original
// generic rejection on nil — **never read nil as "everything is fine"**.
//
// Only asks capabilities that **can state their own tool names** (ToolNameKnower).
// One that can't would need dialing to find out, and this is already a failed
// request — cold-starting a row of sandboxes just to word a message better is a
// bad trade (the [[send_confirmation 19s]] family of costs).
func (r *Registry) HiddenReasonForTool(
	ctx context.Context, in *AssembleInput, tool string,
) error {
	for _, c := range r.enabledCaps(ctx, in) {
		names, known := knownToolNames(c)
		if !known || !slices.Contains(names, tool) {
			continue
		}
		if err := bindingReason(ctx, c, in); err != nil {
			return err
		}
	}
	return nil
}

// bindingReason —— whether this capability can actually assemble in this
// session. If it can → close it, return nil (the caller wants "why is it
// missing", and it plainly isn't).
func bindingReason(ctx context.Context, c Capability, in *AssembleInput) error {
	b, err := c.VisitorBinding(ctx, in)
	if err != nil {
		// Wrap to attribute which capability, but **keep the sentinel**: the caller
		// identifies the reason via errors.Is.
		return fmt.Errorf("capability %q hidden: %w", c.ID(), err)
	}
	closeBinding(b)
	return nil
}
