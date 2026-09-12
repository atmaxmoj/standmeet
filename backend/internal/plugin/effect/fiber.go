// fiber.go —— §4.1 and §4.2 of arXiv:2608.25512: components, fibers, the registry, and the
// nine rules of the calculus.
//
// **Contract only. Every method panics.** Design: `docs/design/plugin/effects.md`.
//
// # What §4 adds to §3
//
// §3 gives one component's effects and one shared coeffect table. §4 is what happens when there
// are *many* components, each arriving and leaving at times nobody scheduled. It is where
// "hot-swappable" stops being a slogan and becomes nine inference rules.
//
// Two relations, and the distinction between them is the whole shape of the thing:
//
//   - an **orchestration** rule (`O-`, written `γ ⇒ δ`) is an action the orchestrator may
//     perform; "its premises say when the action is legal, not when it occurs". Three of them:
//     Insert, Retire, Remove. These are the only external inputs.
//   - a **lifecycle** rule (`L-`, written `γ ⟶ δ`) is "a step the system takes unprompted
//     whenever its premises hold". Six of them: Begin, Iter, Finish, Divert, Leave, Unload.
//
// So the owner's side of the system has exactly three verbs, and everything else is the system
// reacting. That is the mechanical content of "there is no load order to arrange": there is no rule
// by which anyone *starts* a component. `L-Begin` fires because its premises hold.
//
// # The lifecycle
//
//	                         L-Iter ⟲
//	        L-Begin ───────▶ Reloading ────── L-Finish ─────▶
//	∅ ──O-Insert──▶ Inactive             L-Divert            Active
//	  ◀─O-Remove──          ◀── L-Unload ── Unloading ◀─ L-Leave ─
//
// O-Retire is the tenth edge the figure omits: it writes the retirement flag alone and applies at
// every lifecycle state, so it would be a self-loop at each of the four nodes.
//
// # Three design facts here that are easy to get wrong, and that this repo currently gets wrong
//
// **σ is derived, not stored** (equation 46). The coeffect context is `⋃{σ_m | m Active}` — a
// union over the fibers that are *currently Active*, recomputed, never written to directly. "No
// rule writes a table directly: the bindings a fiber provides are the provision stages its own
// effect function performs." A stored registry of seam→supplier rows, which is what
// `plugin.Resolver` is, is the same information in the arrangement where it can disagree with
// reality.
//
// **A fiber in transition provides nothing.** The union is over `Active` alone, so the moment
// `L-Leave` marks a fiber `Unloading` its table leaves σ — before it has withdrawn a single
// binding. "A key its transition has already written is not yet one a dependent may activate
// against." This is what makes the guard below release instead of deadlocking, and it is not an
// optimisation: it is load-bearing for Progress (Theorem 73).
//
// **Deactivation cannot be taken in one step**, and the paper's reason is concrete:
//
//	"A component being torn down because its provider is going away is running its own teardown
//	 code, which may need the very coeffect that is being withdrawn; closing a connection pool
//	 typically means handing the connections back to whatever provided them."
//
// Hence `L-Leave` (decide) separated from `L-Unload` (act), with the guard `¬relied_n(γ)` between
// them. A teardown that needs its dependency has an interval to run in. Every "unregister then
// cleanup" helper in this codebase collapses those two into one call.

package effect

// Name —— a fiber name. Definition 50: "Names are atoms: no rule computes one, inspects its
// structure, or relates two of them by anything but equality, and introducing a fiber simply draws
// one not already in use."
//
// A string here, but the discipline is the point: nothing in this package may parse one. A name
// that encodes the component, the parent or the order of creation is a name some rule will
// eventually be tempted to read, and the calculus is stated over names that carry nothing.
type Name string

// Root —— the parent of a fiber the orchestrator inserted, as against one some fiber
// instantiated.
const Root Name = "root"

// Phase —— Definition 49, equation (43):
//
//	Θ_Γ := Inactive | Reloading(i, g, ω) | Active(g, ω) | Unloading(g, ω)
//
// Four, and the two in the middle exist because "a transition in a real runtime is spread over an
// interval rather than taken in one step". A three-state model (off / loading / on) has no
// Unloading, and therefore nowhere to put the interval a teardown needs.
//
// Distinct from `State` in loader.go, which is what an *entry* shows an owner. A fiber that is
// `PhaseUnloading` shows the owner `StateWaiting` or nothing at all.
type Phase string

// The four lifecycle states of Definition 49. Two are settled (Inactive, Active) and two are
// transitions in progress (Reloading, Unloading).
const (
	PhaseInactive  Phase = "inactive"
	PhaseReloading Phase = "reloading"
	PhaseActive    Phase = "active"
	PhaseUnloading Phase = "unloading"
)

// View —— `ω : d → 𝔑`, the committed view (Definition 49) and the target view (Definition
// 53) share this type, and the lifecycle is driven by comparing them.
//
// **It records the providing fiber, not the value, and not a boolean.** Definition 53's paragraph
// says why: "Recording a provider rather than a value is what makes the comparison usable, since a
// different fiber providing an equal value would otherwise compare equal."
//
// That is the same fact `Scope.Epoch` states for one scope — a provider swapped for another of
// the same name must count as a change. Here it is the type rather than a hash.
type View map[string]Name

// Fiber —— Definition 49: one instantiation of a component, with a lifecycle of its own.
//
// "One component may be instantiated many times over, and each instantiation is activated and
// deactivated over time."
//
// The fields are in the paper's own order — Definition 49's tuple is ⟨d, p, e, π, σ, τ,
// θ⟩ — so that the struct reads against the definition. That is deliberate and costs a few
// bytes of padding.
type Fiber struct {
	Component

	Parent    Name  // π — the fiber this one was instantiated under, or Root
	Retired   bool  // τ — set by O-Retire; monotone (Lemma 59(5)), never written back to false
	Phase     Phase // θ — where in the lifecycle it stands
	Committed View  // ω — carried by every phase but Inactive
}

// Installed (implemented in registry_read.go) —— equation (44): `installed_n(γ) := θ_n ≠
// Inactive`. A fiber that carries an accumulator and a committed view, whichever direction it is
// moving in.

// Registry —— Definition 50: `F_γ : 𝔑 ⇀ 𝔉_Γ`, "a finite partial function whose parent
// pointers form a tree rooted at root, together with whatever else in Γ no fiber's σ names".
//
// The zero value is an empty registry.

// ── Reading the state (§4.1, §4.2.2) ──────────────────────────────────────────

// Coeffects —— equation (46): `σ_γ := ⋃{σ_m | m ∈ dom(F_γ), θ_m = Active}`.
//
// **Derived on every read.** The union is well defined because provisions are disjoint (the fourth
// premise of O-Insert), so each bound key lies in the table of exactly one Active fiber.
//
// Over Active fibers *alone*: a Reloading or Unloading fiber contributes nothing, however much its
// own table holds.

// Provider —— `provider_k(γ)`: the one Active fiber whose table holds k, or "" if none does.

// Target —— Definition 53, equation (48):
//
//	target_n(γ) := ⊥                          if τ_n ∨ ¬(γ ⊨ d_n)
//	               (k ∈ d_n) ↦ provider_k(γ)  otherwise
//
// `ok == false` is ⊥ — "n ought not to be running at all".
//
// "The target answers to two things and to nothing else: retirement, through τ_n, and coeffect
// resolution." No health check, no manual switch, no scheduler. Everything a supervisor would
// normally decide is a consequence of those two.

// Relied —— Definition 54, equation (50): "n is relied upon at γ when some other installed
// fiber resolves a key to it."
//
//	relied_n(γ) := ∃m ∈ dom(F_γ), k ∈ d_m. m ≠ n ∧ installed_m(γ) ∧ ω_m(k) = n
//
// This is **the guard**, the premise on L-Unload, and the thing that makes teardown order a
// derivation rather than a configuration item. It is per *binding*, not per fiber: a fiber that
// declares none of n's keys is no obstacle, and neither is one that resolved n's key in another
// realm.

// Quiet —— Definition 53, equation (49): every fiber has settled at its target view, no
// transition left in progress.
//
//	quiet(γ) := ∀n. target_n(γ) = ⊥    if θ_n = Inactive
//	                target_n(γ) = ω_n  if θ_n = Active(−, ω_n)
//	                ⊥                  otherwise
//
// The third clause is why a Reloading or Unloading fiber is never quiet, whatever its target says.

// Get —— the fiber under this name, or false.

// Names —— dom(F_γ), in insertion order so a test can be written at all. Order carries no
// meaning; no rule of the calculus reads it.

// TableOf —— σ_n, one fiber's own table, whatever its phase. Distinct from Coeffects, which is
// the union over Active fibers alone.
//
// Definition 51 is why this is exposed separately: "the keys of both declarations are read off the
// tables rather than off σ_γ, and the witness condition is why — a binding a transition has
// written stays in the fiber's table before the fiber is Active, and that binding is what the
// inverse is held to remove". A test of recovery has to look here; a test of resolution has to look
// at Coeffects. The difference between the two is exactly what §4.2.2's ordering discipline runs
// on.

// Snapshot —— the control half of a quiesced state: every fiber's phase.
//
// Theorem 80(2) relates two differently-scheduled runs "by the ≃ of Definition 58 and hence by
// ≃_K", a relation finer than ≃_K and so covering the lifecycle states as well as the tables.
// This is that half; the table half is `Coeffects().Equivalent(…)`, and a confluence test needs
// both — comparing only the tables would pass while two fibers ended up in different phases
// holding equal bindings.

// WellFormed —— Definition 63, the invariant Preservation (Theorem 64) preserves:
//
//  1. π_n ∈ dom(F_γ) ∪ {root};
//  2. m ≠ n ⇒ p_m ∩ p_n = ∅;
//  3. installed_n ⇒ ω_n is total on d_n and valued in dom(F_γ);
//  4. installed_n ∧ k ∈ d_n ∧ ω_n(k) = m ⇒ installed_m.
//
// Returns the clause that fails, so a test says which invariant broke rather than "not well
// formed". Exposed because Theorem 64 is a claim about *every intermediate state*, and an invariant
// that cannot be read between two steps cannot be tested at all — only assumed, which is the
// condition it exists to replace.
