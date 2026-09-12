// supplier.go — what a block that supplies a seam must be able to answer.
//
// This interface used to live on a `Hub` type, alongside a registry that resolved
// suppliers BY TYPE: a consumer asked for `contract.CalendarProxy` and got whatever
// satisfied it. That type assertion was the typed surface the block model deletes —
// resolution is by NAME now, and it happens in the substrate (`plugin.Resolver`), not
// here.
//
// What survives is the small thing a supplier still has to answer for itself: who am
// I, what kind of wire do I speak, and is this owner actually connected. None of that
// needs a registry, and none of it is per-vendor.

package adapters

import "context"

// Supplier — a block standing behind a seam.
//
// **Not a second kind of plugin.** There is one Manifest with two directions (see
// `manifest.go`, and the settled note in `docs/design/plugin/block-model.md`); a
// "supplier" is a block whose `Provides` is not empty. This interface is the small
// thing such a block still answers for ITSELF, and it shares the word by accident.
//
// Connected is the only method with a real question in it. It exists because "the
// owner installed a calendar block" and "the owner has authorised it" are different
// facts, and collapsing them is how a visitor ends up offered a tool that will always
// fail. The substrate answers "is there a supplier"; this answers "can it work yet".
//
// In *Spatiotemporal Composability* that predicate is the **check on a provision**
// (Definition 29), which Cordis spells as the third argument of `provide`:
//
//	if (impl.check && !impl.check.call(...)) return delete this._store[name]
//
// A failing check removes the binding from the store, so the key leaves σ_γ, so every
// dependent's target view turns ⊥ and nothing activates against a tool that cannot run.
type Supplier interface {
	Name() string
	// Kind — "openapi" | "protocol" | "sync": which wire this speaks. A consumer
	// that cares reads it rather than type-switching, which is the habit that made
	// the old typed surface necessary in the first place.
	Kind() string
	Connected(ctx context.Context, ownerID string) (bool, error)
}

// Verifier — a supplier that can run a connection test.
//
// A protocol supplier runs this on connect (dial plus auth handshake). One that does
// not implement it needs no test: for oauth and api-key suppliers, saving the
// credential is what makes it usable. Consumers type-assert as needed — an optional
// ability declared by implementing it, which is the same shape the substrate uses
// and the reason it does not need a flag.
type Verifier interface {
	Verify(ctx context.Context, ownerID string) error
}
