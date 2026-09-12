// calculus.go —— §4.2 of arXiv:2608.25512: the nine rules.
//
// Three **orchestration** rules (`O-`, `γ ⇒ δ`), which are actions the outside world may
// perform — "their premises say when the action is legal, not when it occurs" — and six
// **lifecycle** rules (`L-`, `γ ⟶ δ`), which the system takes unprompted whenever their
// premises hold.
//
// The objects these act on, and the lifecycle figure, are in fiber.go.
//
// **Contract only. Every method panics.** Design: `docs/design/plugin/effects.md`.

package effect

// ── Orchestration: the three verbs the outside world has (§4.2.1) ─────────────

// Insert —— O-Insert. Four premises, and the fourth is the one that matters:
//
//	n ∉ dom(F_γ)   π ∈ dom(F_γ) ∪ {root}   (d,p,e) ∈ ℭ_Γ   ∀m ∈ dom(F_γ). p ∩ p_m = ∅
//
// "The last premise of O-Insert is where the single-source discipline is imposed: a key has one
// possible provider because the orchestrator may not admit a second component declaring it."
//
// Note *declaring*, not *installing*. Two components that both declare a seam are refused at
// insert, before either runs — which is strictly earlier than `plugin.NewResolver`'s refusal, and
// strictly earlier than anything that could discover the conflict by watching two writes collide.
//
// The fiber lands `Inactive` with an empty table and `τ = ⊥`. Insert never starts anything.

// Retire —— O-Retire: `n ∈ dom(F_γ) ⊢ γ ⇒ γ[τ_n ↦ ⊤]`. One premise, and it writes
// the flag alone.
//
// "O-Retire is unconditional on the fiber's state because retiring is a request, and the lifecycle
// rules are what carry it out." So this is the owner saying *stop*, and it always succeeds; what
// follows is the system's business.
//
// Retirement is separated from removal because "a retired fiber that is still Active must first be
// deactivated, and removing it earlier would discard the accumulator and leak". A product that
// deletes the row and calls that an uninstall has merged the two — which is the measured gap at
// the top of the design doc, stated as a rule.

// Remove —— O-Remove. Three premises:
//
//	τ_n = ⊤    θ_n = Inactive   σ_n = ∅   ∀m. π_m ≠ n
//
// `∀m. π_m ≠ n` removes children before their parent; `σ_n = ∅` "admits only an entry
// holding no bindings, so that a removal discards none".
//
// The entry may therefore only be dropped once the system has already put everything back. There is
// no forcing variant of this on purpose: a `Remove` that skipped the premises would be exactly the
// `DELETE FROM installed_blocks` this package exists to replace.

// Instantiate —— Definition 52: an iteration of `e_n` may instantiate a component, "which is
// what a plugin host does when a plugin loads plugins of its own".
//
// In place of a state map it takes the O-Insert of that component with `π = n`, **and yields as
// its inverse the O-Retire of the fiber so instantiated** — Retire, not Remove, and the paper is
// explicit that this is forced rather than chosen:
//
//	"The inverse retires rather than removes, and the reason is that an inverse has to apply
//	 wherever it is reached. O-Remove carries premises, so an inverse built from it can fail to."
//
// An inverse that can fail is not an inverse. So a parent's accumulator marks its children and the
// ordinary rules carry them out, one level at a time; the entry left behind is the "vestigial
// entry" of Lemma 62, differing from the fiber's absence in control fields alone.

// Instantiation —— what Definition 52's primitive yields: the drawn name, handed to the effect
// function, and the O-Retire that is the primitive's inverse.
//
// The two travel together because neither is usable alone — a name with no way to retire it is a
// leak, and a retire with no name is nothing.
type Instantiation struct {
	// Child —— the fresh name. "The rule draws the name, subject to the freshness premise of
	// O-Insert, and hands it to the effect function."
	Child Name

	// Undo —— the O-Retire of that fiber. Retire and not Remove: see Instantiate's own doc.
	Undo Dispose
}

// ── The lifecycle rules (§4.2.2) ──────────────────────────────────────────────

// Rule —— which of the six lifecycle rules a step applied. Returned by Step so a test can
// assert on the derivation and not merely on where it ended up; several of §4.3's theorems are
// claims about *which rule fires*, and are untestable against an opaque `Settle()`.
type Rule string

// The six lifecycle rules of §4.2.2, named as the paper names them. Three carry a fiber toward its
// target view (Begin, Iter, Finish) and three carry it away from a committed view that is no longer
// the target (Divert, Leave, Unload).
const (
	LBegin  Rule = "L-Begin"
	LIter   Rule = "L-Iter"
	LFinish Rule = "L-Finish"
	LDivert Rule = "L-Divert"
	LLeave  Rule = "L-Leave"
	LUnload Rule = "L-Unload"
)

// Applied —— which rule a step took, and at which fiber.
//
// Returned rather than just the rule, because several of §4.3's theorems are claims about *which
// rule fires at whom* — Lemma 59 in particular reads as a table of "only this rule writes this
// field" — and a test of one cannot be written against a step that reports only that something
// happened.
type Applied struct {
	Rule  Rule
	Fiber Name
}

// Step applies **one** lifecycle rule, if any applies, and reports which and to whom.
//
// "The rules are nondeterministic: several fibers may hold a committed view differing from their
// target view, and the relation commits to no order among them. They are also reactive only, in
// that no rule mentions a scheduler; the steps are any sequence of rule applications, so a theorem
// proved over all such sequences holds for every scheduling policy a runtime might adopt."
//
// Exposed one step at a time precisely because of that sentence. Confluence (Theorem 80) is the
// claim that *any* sequence lands in the same place, and a test of it has to be able to pick the
// sequence.

// StepAt applies a lifecycle rule to one named fiber, or reports that none applies to it. The
// handle a test needs to drive two fibers in a chosen interleaving.

// Settle runs lifecycle rules until the registry is quiet. Theorem 73 is the claim that this
// terminates; `ErrNoProgress` is what it returns if it did not, which under an acyclic ≺ should
// be unreachable and is therefore worth reporting rather than looping.
