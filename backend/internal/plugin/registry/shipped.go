// shipped.go —— "what does this instance ship", as opposed to "what has this owner
// installed".
//
// It is one question with one answer, and it is the registry's to give: the diag face
// used to walk List() and branch on OriginOf itself, which meant a face knew what an
// origin means. Keeping the filter here also keeps the two halves of the distinction in
// one place — see the comment on Shipped for why the distinction is the point.

package registry

// ShippedBlock —— one shipped block: what it is called, what shape it has, where it
// came from.
type ShippedBlock struct {
	ID     string
	Shape  string
	Origin string
}

// Shipped —— one row per block **this instance ships**, in registration order.
//
// Owner-origin entries are left out, and the distinction is the point. A built-in or
// deploy-declared block is a property of the deployment: the same image yields the same
// list in the same order, which is what makes it answerable as an invariant at all. A
// block an owner installed at runtime is a property of that owner — it appears when they
// paste it and goes when they remove it, so folding it in would make "what does this
// instance ship" depend on who has been using it.
//
// The owner's own blocks are listed on the owner's panel (`blocks.list`), scoped to the
// owner who installed them.
func (r *Registry) Shipped() []ShippedBlock {
	fibers := r.List()
	out := make([]ShippedBlock, 0, len(fibers))
	for _, c := range fibers {
		origin, _ := r.OriginOf(c.ID())
		if origin == OriginOwner {
			continue
		}
		out = append(out, ShippedBlock{
			ID: c.ID(), Shape: string(c.Shape()), Origin: string(origin),
		})
	}
	return out
}
