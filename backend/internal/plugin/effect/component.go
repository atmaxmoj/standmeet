// component.go —— §4.1's first object: the component, and what its effect function is handed.
//
// A component is a *program*; a fiber (fiber.go) is one running instance of it. The split matters
// because "one component may be instantiated many times over", and because everything §4.3
// predicts statically — `≺`, the support set, the cycle report — reads the component's two
// declarations and no fiber's state at all.
//
// **Contract only. Design: `docs/design/plugin/effects.md`.**

package effect

// Component —— Definition 48: `ℭ_Γ := (d : 𝔇_Γ) × (p : 𝔓_Γ) × ℑ_Γ^{d∪p}`.
//
// A triple, and the coeffect side is **split in two directions**: `Requires` is what it reads from
// the environment, `Provides` what it writes to it. The paper calls them "the two directions of one
// interface".
//
// `Provides` is a declaration of what the component **may** provide, not what it has: "no key
// outside p is one its effect function installs a binding at". That makes it checkable before
// anything runs, which is what the whole of §4.3 builds on — `≺` (Definition 72), the support
// set (Definition 74) and the cycle report all read `Requires`/`Provides` and no runtime state at
// all.
type Component struct {
	Requires Spec     // d — dependencies declared
	Provides []string // p — keys this component MAY install; installing outside p is a violation
	Effects  func(Deps) *Iterator
}

// Deps —— what an effect function is handed, and the reason it is a struct rather than a
// context.
//
// §4.2.3's confinement (Definition 55) bounds what an iteration may write — "σ_m|d_n for every
// m ≠ n, and δ(n) and γ(n) differ in σ alone" — and what it may read: "two states agreeing
// on σ_n and on the restrictions σ_m|d_n … are carried by f to states agreeing on the same
// two". What it may neither read nor write is "a table outside the two declarations, any control
// field, or anything no table holds".
//
// Those are exactly the three fields below, and handing the effect function only these makes
// confinement **a property of the signature instead of a rule someone has to check**. A component
// given the whole `*Registry` could branch on another fiber's lifecycle state, and every theorem in
// §4.3 that reads Table 1 as a complete inventory of writes would stop holding — silently,
// because nothing would fail.
type Deps struct {
	// View —— ω, the resolution this activation is running against. Which fiber provides each
	// declared key, fixed for the whole episode (Theorem 71).
	View View

	// Own —— σ_n, this fiber's own table. `Set` here installs a provision, and the Dispose it
	// returns is what withdraws it; a key outside the component's `Provides` is refused with
	// ErrOutsideProvision.
	Own *Table

	// Use —— an operation at a declared key, acting on the value the provider's table holds
	// (Definition 56). The one write outside the fiber's own table that clause (1) permits: "the
	// value at a declared key lives in the provider's table, so a component operating on a coeffect
	// it declared moves σ_m|d_n for the m providing it."
	//
	// A key outside `Requires` is refused — that is clause (2), and it is what stops a component
	// reaching a seam it never declared.
	Use func(k string, op Op) (Outcome, Dispose, error)
}
