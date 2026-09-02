// pertool.go — the **action-level** gate: a capability clearing the gate
// doesn't mean every one of its actions can be performed.
//
// Why this layer is needed (F-B-8 ⭐⭐): `Requires` is capability-level, it
// only answers "connected or not". When an owner has granted only
// `calendar.readonly`, the calendar connection is fine, listing slots is
// fine, **only writes always 403** — yet the product would still put "book a
// meeting" in front of the visitor, and tell them "try again later" (a
// promise that never comes true).
//
// Why the requirement can't just be raised to capability level: that would
// **hide listing slots too**, even though it's fine under a read-only grant.
// Removing a "doable action" to fix "an offered action that can't be
// performed" is not a fix. The product already handles this by action on the
// email side: the confirmation-email part just doesn't render, the booking
// itself still goes through.

package capreg

import "context"

// RequiresPerTool — optional interface: which **specific tools** of this
// capability each need some extra dependency.
//
// The returned table only holds the **explicitly named** ones; not being in
// the table = no extra requirement (true for most).
type RequiresPerTool interface {
	ToolRequires() map[string][]string
}

// dropUnperformableTools — filters once more by each tool's own declared
// dependencies: the one that can't be performed doesn't show up, the ones
// that can stay. Anything undeclared is always kept.
func (r *Registry) dropUnperformableTools(
	ctx context.Context, c Capability, in *AssembleInput, b *Binding,
) {
	reqs := perToolRequires(c, in)
	if len(reqs) == 0 {
		return
	}
	kept := make([]BindingTool, 0, len(b.Tools))
	for i := range b.Tools {
		if r.toolPerformable(ctx, c, in, reqs[b.Tools[i].Name]) {
			kept = append(kept, b.Tools[i])
		}
	}
	b.Tools = kept
}

// perToolRequires — whether this capability has an action-level declaration,
// and whether this session has owner context to judge by. Either not holding
// → empty table → nothing gets filtered.
func perToolRequires(c Capability, in *AssembleInput) map[string][]string {
	pr, ok := c.(RequiresPerTool)
	if !ok || in == nil || in.OwnerID == "" {
		return map[string][]string{}
	}
	return pr.ToolRequires()
}

// toolPerformable — are all the dependencies this one tool names satisfied.
// Not named → keep it. A resolution error is treated as **can't perform**
// (fail-closed, the same discipline as the capability-level layer): when it's
// unclear whether it can be done, don't put it in front of the visitor.
func (r *Registry) toolPerformable(
	ctx context.Context, c Capability, in *AssembleInput, names []string,
) bool {
	if len(names) == 0 {
		return true
	}
	return r.requiredDepsConnected(ctx, c, in, names)
}
