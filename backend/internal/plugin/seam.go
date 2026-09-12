// seam.go — one name, several possible suppliers, a consumer that knows only the name.
//
// This is the mechanism the two axes could not express between them, and the only one
// this design actually adds. A block declared `requires: [calendar]` while a
// supplier declared `category: calendar` — two vocabularies for the two halves of one
// name — and the mail seam was worse: `mail.send` required "smtp", a SUPPLIER's id,
// because the name "smtp" was not in any manifest at all. It was a string hand-written
// into the composition root and registered against the mail slot, which welded that
// block to one supplier for good.
//
// Both halves now spell the seam the same way, in data: `provides` and `requires`.
// Resolution is by name and nothing else — no type assertion, no typed accessor. That
// is what makes a CalDAV block able to replace a Google one without any consumer
// changing, and it is what `supplier-provider-agnostic.spec.ts` has been asserting
// end-to-end all along.

package plugin

import (
	"fmt"
	"slices"
)

// Resolver — which block supplies each seam, and what is still unmet.
//
// Built once from a set of manifests. It holds names, never instances: what sits
// behind a seam is the mounting layer's business, and a resolver that held handles
// would be a registry with a second job.
type Resolver struct {
	supplier map[string]string   // seam -> block id
	requires map[string][]string // block id -> seams it needs
}

// NewResolver — index the manifests, or refuse.
//
// Two live suppliers of one seam is refused rather than resolved. The old registry
// let duplicates settle by registration order, and that is precisely how a test of
// realm isolation once stayed green while the isolation was broken: the wrapper
// happened to be registered last. Order is not a fact about a composition, so a
// resolution that depends on it is not an answer.
func NewResolver(ms []Manifest) (*Resolver, error) {
	r := &Resolver{
		supplier: make(map[string]string, len(ms)),
		requires: make(map[string][]string, len(ms)),
	}
	for i := range ms {
		m := &ms[i]
		if len(m.Requires) > 0 {
			r.requires[m.ID] = m.Requires
		}
		if m.Provides == "" {
			continue
		}
		if first, dup := r.supplier[m.Provides]; dup {
			return nil, fmt.Errorf(
				"seam %q is supplied by both %q and %q: the owner picks one by what he puts in "+
					"the bundle, so two at once has no answer", m.Provides, first, m.ID)
		}
		r.supplier[m.Provides] = m.ID
	}
	return r, nil
}

// SupplierOf — the block supplying this seam, if any.
func (r *Resolver) SupplierOf(seam string) (string, bool) {
	id, ok := r.supplier[seam]
	return id, ok
}

// Unmet — the seams this block needs that nothing supplies, sorted.
//
// Named, not merely counted. The owner has to be told WHICH block cannot work and
// what it is waiting for; "block hidden from this session" with no reason is the
// failure this replaces, and it was found live with a plugin that had died at import.
func (r *Resolver) Unmet(blockID string) []string {
	var out []string
	for _, need := range r.requires[blockID] {
		if _, ok := r.supplier[need]; !ok {
			out = append(out, need)
		}
	}
	slices.Sort(out)
	return out
}

// Seams — every seam with a supplier, sorted. For the owner-facing panel.
func (r *Resolver) Seams() []string {
	out := make([]string, 0, len(r.supplier))
	for seam := range r.supplier {
		out = append(out, seam)
	}
	slices.Sort(out)
	return out
}
