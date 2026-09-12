# Revertible effects — porting Cordis's mechanism, not re-deriving it

> **Status 2026-09-11: IMPLEMENTED.** `backend/internal/plugin/effect/` is a working port, and the
> **128 properties** that specified it all pass — every numbered result of §3, §4 and §6.1, named by
> number. They run in `make backend-test` like any other test; the `effectcontract` build tag that
> held them while the package was a contract of panicking stubs is gone, along with the lint
> exemptions that phase needed.
>
> **The properties were shown to be falsifiable, not merely green.** Two mutations of the
> implementation were applied and the suite measured:
>
> | mutation | properties that went red |
> |---|---|
> | revert the accumulator in application order instead of LIFO | **7**, incl. Thm 5.2, Thm 16.1, Cor 69 |
> | let a fiber in transition keep providing (σ_γ over *installed* rather than *Active*) | **11**, incl. the whole teardown family and the guard |
>
> The second is the one the paper says everything rests on, and it is what the suite is most
> sensitive to — which is the right shape.
>
> **Where the implementation departs from the paper, and why.** Three places, each checked against
> Cordis rather than reasoned about:
>
> 1. **A failed activation marks the fiber.** Definition 48's effect function is total, so §4.2 never
>    asks what happens when one raises. Cordis must: `_reload` catches, sets `this._error`, and
>    `_setEpoch` then refuses to act. Without it the calculus livelocks on a broken component —
>    L-Begin, raise, L-Unload, Inactive, target still ≠ ⊥, L-Begin — and Theorem 73's termination is
>    lost to a hypothesis the paper was entitled to make and an implementation is not.
> 2. **Unload is LIFO, where Cordis's `Fiber._unload` is concurrent** (`Promise.all`), reserving LIFO
>    for the disposers collected within one effect. Both are sound: Theorem 43 says independent
>    effects "reach γ₀ under the order of ANY permutation", so concurrent is one of the allowed
>    permutations. LIFO is the one Definition 9 names, and it is what a port that cannot see whether
>    two effects are independent should take.
> 3. **The single-source premise is enforced one step earlier than Cordis can.** `reflect.ts` refuses
>    a second `provide` of a key; O-Insert here refuses a second component *declaring* it, before
>    either has run. Cordis cannot, because a plugin's services are not declared up front — a
>    manifest's `provides:` is, and that is what lets §4.3 predict the quiesced state statically.

## Why this document exists

`block-model.md` adopts Cordis's vocabulary wholesale — **plugin**, **fiber**, **service**,
**effect** — and its table (§"The four properties translate without the library") maps each Cordis
mechanism onto a Go equivalent. Two of those rows describe machinery **that does not exist in this
codebase**:

| the table claims | grep says |
|---|---|
| `epoch` = concatenated uids of bound providers; any missing → inactive, any swapped → reload | no `epoch`, no reload |
| `Effect(setup) (dispose, err)`; disposers run in reverse, refused once unloading (`INACTIVE_EFFECT`) | no `Effect`, no disposer, no `INACTIVE_EFFECT` |

`registry.Fiber` borrows the name and is something else: a **static registration interface** (a block
declares its visitor binding, owner tools, state) with no lifecycle, no epoch and no disposers.

The doc is not simply wrong — further down it says the staged lifecycle was **deliberately replaced**:
mounting is not staged, a block whose seam has no supplier is not exposed, and the set is *recomputed
at every assembly* rather than parked in a state. That decision stands and this document does not
reopen it.

What the recompute strategy does **not** cover is the other half of the paper: an effect that reaches
**outside** the assembled set. Recomputing which tools a session sees cannot un-create a postgres
schema.

## The gap, measured

`blockstore.Store.Drop` exists, and its comment says what it is for:

> `// Drop —— when a supplier/mcp is uninstalled, delete its entire schema (CASCADE, data…)`

Every caller is a **microsite**. No block-uninstall path calls it. `assembly.Repo.Uninstall` is one
statement:

```go
const q = `DELETE FROM installed_blocks WHERE owner_id = $1 AND block_id = $2`
```

So uninstalling a block leaves its schema, every document in it, and its config values behind. Found
by looking, not by reasoning: `mcp_acme_widget_zzfixture` — a schema created by a **fixture block in
one test** — was still in the database after a full suite, a `dev-down`, and a `dev-up`.

In the paper's terms that is a failure of **temporal composability**: a context transformation
(provisioning storage) was applied without the runtime holding its inverse.

## The formalization, and where each piece lands in Go

From *Spatiotemporal Composability* (arXiv:2608.25512) §3. The value of reading the formal part
rather than the abstract is that the definitions **are** the type signatures — there is nothing left
to invent.

**Definition 2 — the effect context.** `∂Γ := Γ × (Γ → Γ)`, a pair `(γ, φ)`:

- `γ : Γ` — the current state of the world;
- `φ : Γ → Γ` — the **accumulator**: "the composite of the inverses of the effects performed so
  far, and the function that recovers the context to its initial state."

The initial effect context is `(γ₀, id)`. **`φ` is the disposer stack**, and the paper's insistence
that it is a *composite function* rather than a list is why `Unload` has no partial mode.

**Definition 8 — the effect function.** `𝔈_Γ := Γ → Γ × (Γ → Γ)`.

The paper arrives here by rejecting the simpler `track(f, g)` model, and the reason is exactly the
shape of a Go API:

> "`track(f,g)` fixes `g` before any context state is seen… **A per-state inverse cannot be fixed in
> the argument position before the state is seen; it has to be returned at the point of
> application.**"

That sentence is the signature:

```go
type Setup func() (Dispose, error)   // Γ → Γ × (Γ → Γ)
```

The inverse comes back **from** the setup, not alongside it. An API that took `(apply, revert)` as
two arguments would be the model the paper discards on page 12.

**Definition 9 — effect composition.** `(f ⋄ g)(γ) = let (δ,s) = g(γ) in let (ε,t) = f(δ) in (ε, s∘t)`

`g` runs first, `f` second, and the accumulated inverse is `s ∘ t` — which applies `t` first. **The
later effect is reverted first.** Reverse-order disposal is not a convention borrowed from Cordis's
implementation; it falls out of the composition operator.

**Theorem 7 — the soundness invariant.** `φ(γ) = γ₀`. Recovering after a tracked effect whose
inverse reverts it lands where recovering before it would have. This is the single property the
whole port exists to provide, and the one thing worth asserting end to end.

**Theorem 43 — order-independence under independence.** For pairwise independent effects applied
from `γ₀`, applying the inverses "**in the order of any permutation of {1,…,n}, reaches γ₀**."

So LIFO is required only where effects are *not* independent. That splits the test matrix in two,
and the paper says which side a given key falls on:

**Definition 44 / Theorem 45 — what makes a key commutative.**

> "A key whose value is a **table of entries** is commutative when each registration takes an entry
> of its own, registration of a route or of an event listener being the representative case… A key
> whose value is an **ordered chain** is not commutative, since a middleware inserted before another
> sees a different request."

and **Theorem 45: operations at distinct keys are independent, outright.**

Read onto this codebase:

| our key | shape | commutative? | consequence |
|---|---|---|---|
| the block registry | a table, one entry per block id | **yes** — Def 44's representative case | two blocks' registrations are independent (Thm 45); any revert order restores (Thm 43) |
| a block's own postgres schema | a distinct key per block | **yes** | ditto |
| a **seam** | one slot, one active supplier | **no** — a single binding, not a table | order would have to be imposed from outside… |

…and the last row is already how the code behaves, which is the pleasing part: `plugin.NewResolver`
**refuses two suppliers of one seam at load**. In the paper's terms that is the prescribed treatment
of a non-commutative key —

> "a key whose operations do not commute is one whose order has to be imposed from outside the
> effects"

— imposed here by making the ambiguity a startup failure instead of a race. The existing guard is
not an ad-hoc safety check; it is the coeffect discipline, already paid for.

**Theorem 16 / §3.4 closing.** Within one component the accumulator imposes LIFO; across components a
declared coeffect imposes the order. Two places, two mechanisms — which is why `Scope` (one
component's accumulator) and seam resolution (across components) stay separate types here.

## What Cordis actually does

Read from `cordiverse/cordis`, `packages/core/src/fiber.ts` (MIT, © 2021-present Shigma). Five
mechanisms, and the port copies the semantics of each rather than inventing its own:

**1. Disposers are collected per fiber and run in reverse.**

```ts
const dispose = () => {
  for (const dispose of disposables.splice(0).reverse()) { … }
}
```

`splice(0)` empties the array *before* iterating: the same call is both the reverse-order run **and**
the double-dispose guard. Calling dispose twice is a no-op, structurally, not by a flag.

**2. A failed setup rolls back its own partial effects.**

```ts
try { task = this._execute(runner) }
catch (reason) { dispose(); throw reason }
```

An effect that half-applied does not leave the halves behind.

**3. One disposer failing does not stop the others.**

```ts
await Promise.all(this._disposables.clear().map(async (dispose) => {
  try { await … dispose() } catch (reason) { this.ctx.logger.error(reason) }
}))
```

Errors are collected and logged; unload always completes. The alternative — abort on first error —
turns one stuck disposer into a permanent leak of everything registered after it.

**4. Registering an effect on a dead fiber is refused, loudly.**

```ts
assertActive() { if (this.uid !== null) return; throw new CordisError('INACTIVE_EFFECT') }
```

**5. `epoch` is the dependency identity, and changing it drives activation.**

```ts
for (const name of Object.keys(this.inject)) {
  const impl = this._store[name]
  if (!impl) { epoch = INACTIVE; break }
  epoch += ':' + impl.fiber.uid
}
```

Not a boolean "are my deps present" but the **identity** of the exact providers bound to. A provider
swapped for a different one of the same name changes the epoch, and the fiber reloads — which a
presence check would miss entirely.

## The port

New package `backend/internal/plugin/effect/`. It owns the mechanism and knows nothing about blocks,
postgres or seams — the same separation Cordis keeps between `fiber.ts` and its plugins.

```go
// Dispose — the inverse of one transformation.
type Dispose func() error

// Setup — apply a transformation, hand back its inverse.
type Setup func() (Dispose, error)

// Scope — a set of transformations that are reverted together, newest first.
type Scope struct { … }

func (s *Scope) Effect(label string, up Setup) error   // ErrInactive once Unload has begun
func (s *Scope) Unload() error                          // reverse order; every disposer runs
func (s *Scope) Epoch() string                          // "" == inactive
func (s *Scope) Bind(deps map[string]string) (changed bool)
```

Deliberate differences from the TypeScript, each with a reason:

| Cordis | here | why |
|---|---|---|
| async disposers, `Promise.all` | synchronous `func() error` | Go's unit of "later" is the caller's goroutine; making every disposer async would put a scheduler in a package whose whole job is to be boring |
| `logger.error(reason)` per failure | `errors.Join` of every failure, returned | same semantics — all disposers run, nothing is swallowed — but the caller decides whether a failed inverse is fatal. A mechanism package that logs has picked a policy for its callers |
| `splice(0).reverse()` | take the slice under the mutex, nil the field, then walk it backwards | same structural double-dispose guard, spelled for Go's memory model |
| six `FiberState`s | `Epoch() == ""` and an `unloading` flag | the states Cordis needs are driven by async loading. Our mount is synchronous, and the decision in `block-model.md` was explicitly **not** to add a lifecycle. Two bits is what is left when the async is removed |

## The test matrix — one test per formal result

Each test is named for the result it checks, so a reader can go from a red test to the page that
says why it must hold. **The world `Γ` in these tests is a plain `map[string]string`** — the paper's
`Γ` is any state, and a map makes "recovered to its pre-composition state" a single `reflect.DeepEqual`
rather than a story about mocks.

| # | paper | test | how it fails |
|---|---|---|---|
| 1 | Def 8 — the inverse is returned at the point of application | `TestSetupReturnsItsOwnInverse` | a `Setup` that returns a nil `Dispose` is refused; an API that accepted `(apply, revert)` separately could not express a per-state inverse |
| 2 | **Thm 7 — soundness invariant `φ(γ) = γ₀`** | `TestUnloadRecoversTheInitialState` | apply N effects that mutate the map, `Unload`, compare to the snapshot. This is the property; everything else is a way for it to break |
| 3 | Def 9 — inverses accumulate as `s ∘ t` | `TestRevertOrderIsLIFO` | effects whose inverses are order-sensitive (append to a log) revert newest-first |
| 4 | Def 2 — `φ` is a composite, and recovery resets it to `id` | `TestUnloadTwiceIsANoOp` | the second `Unload` must not run any disposer again |
| 5 | §3.1.2 — a partially applied effect holds no residue | `TestFailedSetupRevertsItsOwnPartialWork` | a `Setup` that registers two nested effects and then fails leaves neither |
| 6 | Cordis `_unload` — one failure does not strand the rest | `TestOneFailingDisposerDoesNotStrandTheOthers` | every disposer runs; the errors are `errors.Join`ed, not swallowed and not short-circuiting |
| 7 | **Thm 43 — any permutation reverts independent effects** | `TestIndependentEffectsRevertInAnyOrder` | effects on **distinct keys** (Thm 45) are reverted in a shuffled order and still reach `γ₀`. Fails if the implementation smuggles in a shared cursor |
| 8 | Thm 45 — distinct keys are independent | `TestDistinctKeysDoNotDisturbEachOther` | two scopes interleave their effects; unloading one leaves the other's writes exactly as they were |
| 9 | Def 44 — a non-commutative key must be refused, not ordered | `TestSingleSlotKeyRefusesASecondClaim` | two effects claiming one seam-like slot: the second is refused at claim time. This is `NewResolver`'s existing rule, stated as the law it implements |
| 10 | Cordis `assertActive` | `TestEffectAfterUnloadIsRefused` | registering after `Unload` has begun returns `ErrInactive` rather than leaking an effect nothing will revert |
| 11 | epoch = identity of bound providers, not presence | `TestEpochChangesWhenAProviderIsSwapped` | rebinding the same **name** to a different provider changes the epoch; a presence check would not notice |
| 12 | hot replacement (§5.2.2) | `TestReloadLeavesNoResidue` | unload + re-apply returns the world to the same state as applying once from `γ₀` |

Numbers 2 and 7 are the two that matter most and the two most easily faked: both are a `DeepEqual`
against a snapshot taken before anything ran, so an implementation cannot satisfy them by remembering
what it was asked to undo.

## Integration — the configuration tree is the UI

> Learning target for this layer is **dsh**, and **Koishi** (§5.3, 4000+ community plugins) for the
> owner-facing half. Koishi's console is itself a second, independent Cordis application: the same
> primitives, composed over browser and UI rather than server. That is the strongest available
> evidence that the model reaches the screen rather than stopping at the runtime.

"Blocks like Lego" sounds like it makes the owner's screen harder — more pieces, more ways to
connect them wrong. **§5.2.1 and the metatheory say the opposite, and say exactly why.** Four
results, each removing something the UI would otherwise have to do:

**Theorem 70 — there is no load order for the orchestrator to arrange.** A fiber whose declared keys
are not yet provided *waits*; one whose provider leaves is deactivated ahead of it. Koishi's
ecosystem is the demonstration: "a plugin whose dependency is unavailable **stays inactive until it
appears, without erroring**."

So the owner never sequences anything. Drop a block in, and it sits inactive — not failed, not
erroring — until its seam has a supplier, then activates on its own. **The UI has no "you must
install X first" dialog because the runtime has no such requirement.**

**Theorem 80 — the quiesced state is a function of the final configuration alone.** Whatever
instantiations and retirements the loader performs on the way, and in whatever order, the system
ends where a load of the final configuration from scratch would have left it.

That is the sentence that makes a Lego UI safe: **the owner cannot reach a bad state by doing things
in an unusual order.** There is no "undo" to design, because there is no path-dependence to undo.

**Corollary 69 — rebuilding one entry leaves the fibers around it as they were.** Editing one
block's settings does not disturb its neighbours, so the screen can let the owner edit in place
instead of taking the system down and bringing it back.

**Definition 81 — the entry, and per-field reconciliation.** An entry records `id`, `url`,
`isolate`, `intercept`, `config`, `disabled`, and the loader "dispatches on which of the entry's
fields changed and applies the **least disruptive operation** for each":

| field changed | what happens | what the owner should be told |
|---|---|---|
| `intercept` | updated in place, **no reload** | nothing — it is free |
| `config` | handed to the component, which reloads only on a *material* change | "applies immediately" or "restarts this block", decided by the block, not guessed by the UI |
| `disabled` | unloads when set, reloads when cleared | the toggle is honest: off really reverts, it does not merely hide |
| `isolate` | realms reassigned | "this changes who shares its data" |
| `id` / `url` | rebuilds the entry | "this replaces the block" |

**A UI that knows this table can price every edit before the owner makes it.** Today our panel
cannot: every change looks the same to it.

**The binding runs in both directions.** The loader adjusts the fiber when an entry changes, *and* a
component that revises its own configuration or disables itself has the change **written back to its
entry**. A block that fails and takes itself out of service is therefore visible on the screen as a
disabled entry, rather than as a tool that silently stopped appearing — which is exactly the failure
mode `block-failure-three-faces` was written against.

### We already have the entry, scattered across four tables

Definition 81's six fields exist here — just not in one place, and with no reconciliation and no
write-back:

| Def 81 | where it lives today |
|---|---|
| `id` | `installed_blocks.block_id` |
| `url` | `installed_blocks.manifest` (the block itself, not a URL to fetch) |
| `config` | the block's own store, collection `blockconfig*` |
| `disabled` | `block_enabled.enabled` — a **separate table** |
| group nesting | `bundles` + `bundle_blocks` |
| `isolate` | the per-block schema, implicitly |
| `intercept` | — nothing |

So the pieces are there and the **mechanism over them is missing**: nothing diffs a desired
configuration against the running one, nothing dispatches per changed field, and a component cannot
write back to its own entry. Four tables edited independently is what a configuration tree looks like
before anyone has written the loader.

That is the honest size of this work: not "adopt a new model", but "give the model we already
half-built the reconciliation step that makes its guarantees true".

### What this means for our screen

Our block panel is a flat list of registry ids with an on/off switch. The entry model says it should
be **the configuration tree itself**: entries, nestable into groups, each showing its own state
(active / waiting on a seam / disabled / failed), each editable in place. Not because trees are
nicer, but because the tree is *the authoritative record of what the system loads* — anything else is
a second representation that can drift from it.

### The system boundary decides what "revert" can honestly promise

§6.1 draws the line the UI must not cross: a location is **inside** the system when the system can
modify it exclusively *and* restore the prior state; **outside** when either fails, and an operation
on it "acts as `id_Γ` and is therefore **neither tracked nor reverted**".

An email that has been sent is outside. A calendar event on Google's servers is outside unless the
supplier can delete it. **A confirm dialog that says "this will be undone" must be derived from that
boundary, not written by hand** — and the honest UI shows two lists: what removing this block
reverts, and what it cannot.

§6.1 also gives the way to move the line: "a coeffect moves the boundary by reifying an external
location — confining every access to a set of operations it provides, each of which it can supply an
inverse for." That is precisely what a seam is. A calendar seam whose operations each carry an
inverse makes calendar writes revertible; one that exposes raw HTTP does not.

## Exposure — the formalization decides what the agent may call

The mechanism is worth porting only if it changes what reaches a person. It does, in a specific way:
**the formal class of an operation determines its surface.** Three facts, each already proved above,
each with a consequence that is not a matter of taste.

### 1. A revertible op can tell the truth about what removing it will do

Once the runtime holds the inverse (Thm 7), "delete this block" stops being a leap. The accumulator
knows what will be undone, so the confirm dialog can name it — *"also deletes: 47 bookings, 3
settings"* — instead of the generic warning a system without inverses is forced to show.

Today it is worse than generic: `blocks.delete` says built-ins cannot be removed and says nothing
about the schema it orphans, because nothing in the code knows.

### 2. Commutativity picks the widget

Definition 44 divides keys, and each side has exactly one honest control:

| key | Def 44 | control | why the other control would lie |
|---|---|---|---|
| the block registry — a table, one entry per id | commutative | **multi-select**, remove in any order | Thm 43: any permutation reverts. Forcing a sequence would invent an order the system does not have |
| a **seam** — one slot | not commutative | **single-select**, and switching is a *displacement* | a checkbox list implies two calendars could both be active. `NewResolver` refuses that at load, so the UI must refuse it at the click |

The supplier picker being a radio button is not a style decision; it is Definition 44 read onto the
screen. And the reverse holds: if someone ever ships a seam picker that allows two, the load-time
refusal turns it into an instance that will not boot.

### 3. Epoch identity turns a silent reload into a stated one

Because epoch is the identity of the bound providers and not their presence, swapping a calendar
supplier is *detectable* as a change. That is the difference between the owner clicking "switch to
CalDAV" and finding out later that booking behaved differently, and the UI saying **"this reloads 3
blocks that depend on `calendar`"** before the click.

### The exposure rule

`fp.Reach` already carries this: `Only(reason, facades…)` pins an op to named facades and **requires
a reason**, so "human but not agent" is expressible today and is recorded as a reviewed decision
rather than a silent gap. What is missing is the rule saying which class goes where:

| formal class of the op | owner surface | agent surface |
|---|---|---|
| revertible, commutative key (install, enable/disable) | ordinary control | full op, plain description |
| revertible, **non-commutative** key (activate a supplier on a seam) | single-select + "displaces X, reloads N" | op exposed, and its description **must state the displacement** — an agent that cannot see the coeffect will treat a swap as an addition |
| **irreversible** (destroys state whose inverse was never held) | confirm, with the loss named | **`Only("…", "admin")`** — not handed to an agent at all |
| the `(apply, revert)` pair — the model Def 8 discards | not offered | not offered |

That last row is the sharpest, and it is the one the paper settles for us. A surface shaped
`register(apply, revert)` asks its caller to supply an inverse **before seeing the state it will
have to revert** — §3.1.2 shows that inverse cannot be correct in general. So it is not a question of
whether an agent is trusted with it: the shape is wrong for every caller, and neither plane gets it.
An owner who wants "do X, and here is how to undo it" is asking for a weaker guarantee than the
system already provides.

### Integration tests — their own layer, their own file

The property tests in this package prove the mechanism. They cannot see whether the product **uses**
it. Integration tests belong where the ops are declared (`cmd/server/blockwire/`, beside the
existing `TestParityPluginClaimsAreReal`, which is the same shape of check: a claim in one place
kept honest against the declarations in another).

| claim | test | how it fails |
|---|---|---|
| uninstall runs the inverse of provisioning | `TestUninstallDropsTheBlocksStorage` | install a block, uninstall it, assert its schema is gone — the measured gap at the top of this document |
| no op destroys owner state without being pinned | `TestIrreversibleOpsAreNotHandedToAgents` | every op whose class is irreversible carries `Only(…)`; a new one added with a bare `OwnerAction()` goes red |
| a seam is a single slot everywhere | `TestSeamActivationIsASingleSlot` | two suppliers activated on one seam: the second is refused, at the op, not only at load |
| a swap is stated, not silent | `TestSupplierSwapNamesWhatItDisplaces` | the activate op's description mentions displacement; an agent reading only the name would take a swap for an addition |

These are deliberately **not** e2e: each is a statement about the op table and the mechanism, and an
e2e would prove the same thing far more slowly while being unable to say which of the two broke.

## Borrowing Koishi's ecosystem — and why a unit test cannot prove it

Koishi is Cordis plus chatbot vocabulary, MIT, same author, **4000+ community plugins** (§5.3). The
tempting move is to reimplement enough of Cordis in Go that those plugins run here. That is the
reinvention trap wearing a compatibility badge: the plugins are Node modules that take a `ctx` and
call `ctx.effect` / `ctx.command` / `ctx.plugin`, so "compatible" means **being Cordis**, and a
second implementation of a formalism whose whole value is its metatheory is the one thing not worth
writing twice.

The cheaper and more honest path is the one this architecture already supports: **host the real
thing inside a block.** A `koishi-host` block runs Node + real Koishi in the sandbox we already use
for every other block, and projects its commands as agent tools. The Go `effect` package keeps
owning *our* lifecycle; the ecosystem comes from running their code, unmodified.

### Which claims go to UT and which to e2e

The split is not a matter of taste, and the rule is inherited from
`real-third-party-mcp-sandboxed.spec.ts`, which states it exactly:

> "every other MCP-app test loads a server **we wrote**… Green there only proves the loader fits our
> own modules — **circular**. This loads a REAL third-party server we did NOT author… If the unified
> loader can discover + invoke a stranger's server, it is genuinely general, **not curve-fit to us**."

A unit test on this surface has to fake the Koishi side, and a fake agrees with whatever we expected
— which is the whole question. So:

| claim | side | why it cannot go to the other side |
|---|---|---|
| a Koishi command's schema becomes an agent tool spec | **UT** | pure translation: data in, data out. No process, no npm, no `ctx` |
| our `Entry` becomes a Koishi entry (`id`/`url`/`config`/`disabled`) | **UT** | ditto — and the mapping is where Def 81 either survives the trip or quietly loses a field |
| a Koishi error becomes a `DisplayError` the owner can read | **UT** | a table of strings |
| **a real, unmodified `koishi-plugin-*` from the registry loads** | **e2e** | depends on npm resolution, Node, real Cordis lifecycle. A fake proves none of it |
| **its command is callable by a visitor's agent, end to end** | **e2e** | the claim *is* "a stranger's plugin works here" |
| **disabling it reverts its effects in place** (§5.3's headline) | **e2e** | the revert happens inside Cordis, in another process, in another language |
| the host block itself mounts no `net` unless granted | **e2e** | the sandbox is a kernel feature; a UT cannot observe bwrap |

The e2e must use a plugin **we did not author**, installed from the registry unmodified. Koishi's own
`@koishijs/plugin-mock` is third-party *to us* and is what their loader spec uses, so it is the
cheapest first target; a community plugin from npm is the one that actually substantiates "4000
plugins", and is the second.

### The one thing a UT here would get wrong

A UT that stubs the Koishi side will pass while the real integration fails on **module resolution**
— the thing this repo has already been bitten by at the microsite builder, where the vendor set is
frozen into an image and a page importing a seventh package cannot resolve at all
(`microsite-build.md`, and rows 7 and 9 of `tests.md` are still owed for it). A Koishi host has the
same shape and the same failure: `ctx.plugin(require('koishi-plugin-x'))` works in our fixture and
does not work in the container, and only a test that installs the real package sees it.

## Coverage audit — what of the paper this framework states, and what it does not

Kept as a table rather than a claim, because "we covered the paper" is exactly the kind of sentence
that is true when written and false a week later.

| § | result | in the contract | properties |
|---|---|---|---|
| 3.1.1 | Def 2 effect context, Thm 4, **Thm 5 monoid homomorphism**, Def 6 recover, **Thm 7 soundness invariant** | `Scope`, `Unload` | ✅ `effect_test.go` (14) + `theorem7_test.go` (9) |
| 3.1.2 | **Def 8** per-state inverse, Def 9 `⋄`, Thm 16 LIFO | `Setup`/`Dispose` | ✅ |
| 3.1.3 | **Def 17/18 effect iterators**, **Thm 16**; the `Maybe` continuation as a reified delimited continuation | `Step`, `Iterator`, `Run`, `Advance`, `Once` | ✅ `iterator_test.go` (6) |
| 3.2.1 | Def 19 Σ, **Def 20 set-is-an-effect** | `Table`, `Set` | ✅ `coeffect_test.go` (11) |
| 3.2.2 | Def 21 spec, **Def 22 notify** | `Spec`, `Notify` | ✅ |
| 3.2.3 | Def 23 realizations, Def 24 isolation, Def 26 interception | `Isolate`, `Intercept`, `Meta` | ✅ |
| 3.3.1 | **Def 28 unified context** `Γ∞ := μΓ. Γ × (Γ→Γ) × Σ` — no lifting, only nesting | `Scope.Child`, `Scope.Coeffects` | ✅ `nesting_test.go` (6) |
| 3.3.2 | Def 31 tests-as-words, **Def 33 ≃_S**, Lemma 32, **§3.4.2's design lever** | `Indistinguishable`, `Equivalent`, `RespectedBy`, `Observers` | ✅ `equivalence_test.go` (7) |
| 3.4.1 | Def 42 independence, **Thm 43 any permutation** | — | ✅ |
| 3.4.2 | Def 44 commutativity, **Thm 45 distinct keys**, Def 46 witness | `Coeffect.Commutative` | ✅ |
| 4.1 | Def 48 component, Def 49 fiber, **Def 50 registry** (σ derived, eq 46), Def 53 target view, Def 54 `relied` | `Component`, `Fiber`, `Registry`, `View` | ✅ `fiber_test.go` (13) |
| 4.2 | the nine rules: **O-Insert/Retire/Remove**, **L-Begin/Iter/Finish/Divert/Leave/Unload**; Def 52 instantiation; **Def 55 confinement** | `Insert`…`Step`/`StepAt`, `Instantiate`, `Deps` | ✅ |
| 4.3 | **Thm 64 Preservation**, Thm 68/Cor 69 recovery exactness, Thm 70 ordering, Thm 71 resolution coherence, **Thm 73 Progress**, **Thm 80 Confluence**, Def 72 `≺`, Def 74 support | `WellFormed`, `Snapshot`, `Cycles`, `Support`, `Total` | ✅ `metatheory_test.go` (11) |
| 5.2 | **Def 81 entry**, per-field dispatch | `Entry`, `Loader` | ✅ `loader_test.go` (6) |
| 6.1 | **system boundary**: inside/outside, acquisition/emission, withholding vs compensation | `Location`, `Side`, `Stage`, `Recovery`, `Reify` | ✅ `boundary_test.go` (5) |

### Every numbered result, and where it is tested

The table above is by section; this one is by result, because "we covered the paper" is checkable only
against the paper's own numbering. **35 numbered results, 35 covered.**

| result | claim | file |
|---|---|---|
| Thm 4 | tracking leaves the forward map alone, whatever inverse it carries | `theorem7_test.go` |
| Thm 5 | `track` is a monoid homomorphism; the composite is **twisted** ⇒ LIFO | `theorem7_test.go` |
| **Thm 7** | **soundness invariant `φ(γ) = γ₀`** — proved as a 4-equality chain, one test per line | `theorem7_test.go` |
| Thm 10 | `(𝔈_Γ, ⋄)` is a monoid with unit `η_Γ` | `lifting_test.go` |
| Thm 11 | `𝔈*_Γ` is a **submonoid**; a uniform inverse witnesses everywhere | `lifting_test.go` |
| Thm 13 | `effect` preserves `⋄` | `lifting_test.go` |
| Thm 14 | lifting leaves forward behaviour untouched | `lifting_test.go` |
| Thm 15 | reverting early recovers exactly; the lift is **not** closed | `lifting_test.go` |
| Thm 16 | each revert meets its own state; every intermediate state is sound | `iterator_test.go` |
| Lemma 32 | `≈` is the coarsest relation every operation respects | `equivalence_test.go` |
| Lemma 35 | `≃_S` is a **partial** equivalence; respect is a condition, not a given | `relation_test.go` |
| Lemma 38 | every §3.1 equality holds with `=` replaced by `≃`, with no drift | `relation_test.go` |
| Lemma 39 | a component is witnessed at exactly the keys it declares | `relation_test.go` |
| Lemma 41 | commutation is settled on the **generators**; `⋄` enlarges nothing | `relation_test.go` |
| Thm 43 | independent effects revert under **any permutation** | `effect_test.go` |
| Thm 45 | distinct keys are independent outright | `effect_test.go` |
| **Thm 47** | **independence is decidable from two manifests** | `independence_test.go` |
| Lemma 57 | an effect function moves no other fiber's table **domain** | `invariants_test.go` |
| Lemma 59 | who may write each field: `σ`, `ω`, `g`, `π/d/p/e`, `τ` | `invariants_test.go` |
| Lemma 60 | the rules cannot see what `≃` forgets — no premise reads a value | `invariants_test.go` |
| Lemma 61 | equivariance: names are atoms, renaming changes nothing | `invariants_test.go` |
| Lemma 62 | a vestigial entry is indistinguishable from absence | `invariants_test.go` |
| **Thm 64** | **Preservation** — every rule preserves well-formedness | `metatheory_test.go` |
| Lemma 66 | every sequence of steps is pairwise independent | `independence_test.go` |
| Lemma 67 | an entangled fiber's steps are `id_Γ` while its consumer is installed | `independence_test.go` |
| Thm 68 | recovery exactness at **every** point of an episode | `metatheory_test.go` |
| Cor 69 | a departing fiber leaves its neighbours as their own steps left them | `metatheory_test.go` |
| Thm 70 | **Ordering** — a provider outlives its consumer | `fiber_test.go`, `lifecycle_test.go` |
| Thm 71 | **Resolution coherence** — one resolution per transition | `composability_test.go` |
| **Thm 73** | **Progress** — no deadlock, and `S(n) ≤ (K+3)(V(n)+1)` | `composability_test.go` |
| Lemma 75 | support is well founded (a parent is older than its child) | `invariants_test.go` |
| Lemma 77 | at quiescence the support set **is** the Active set | `composability_test.go` |
| Lemma 78 | adjacent steps at distinct fibers transpose | `independence_test.go` |
| Lemma 79 | a closed episode can be deleted from the history, children included | `independence_test.go` |
| **Thm 80** | **Confluence** — the quiesced state is the statically assembled one | `composability_test.go` |

Plus one file that is not keyed to a theorem: **`teardown_test.go`**, the uninstall suite. §4.2.2 says
"**a guard of this kind ordinarily deadlocks**", and the only thing that saves `¬relied_n(γ)` is that
σ_γ unions Active fibers alone — so an implementation that stores the provider table, or that unions
Unloading fibers too, wedges on uninstall and shows the owner a spinner. That file pressure-tests the
one fact across the topologies where a hand-rolled teardown order breaks: the second-order cascade
(A → B → C, only A retired), retirement in every request order, fan-in (the last dependent releases,
not the first), the diamond, parent/child (ordered along coeffects and **not** along the fiber tree),
a `≺`-cycle, a stuck disposer that must not strand the chain behind it, and finally that every fiber
becomes O-Remove-able — i.e. that "uninstall" is a button that can actually complete.

Guard against this table going stale — it is a claim that rots:

```
cd backend/internal/plugin/effect && grep -ho '\(Theorem\|Lemma\|Corollary\) [0-9]*' *_test.go | sort -u
```

Three things the coverage does *not* claim:

- **§5 beyond Def 81** — the implementation chapter (Cordis's own internals: the `epoch` hash, the
  `_disposables` splice, the app-card protocol). Read and ported where it informed the contract, but
  it is Cordis's engineering, not the paper's theory, so there is nothing here to be measured against.
- **§6.2–6.7** — service multiplexing, the broker, language requirements, co-design. §6.2's broker is
  the one with a product consequence (it is how a supplier can be updated *without* perturbing its
  consumers, where `Slot`'s exclusive binding must perturb them), and it is unbuilt. §6.6's nominal
  linking is discussed above but has no test, because the remedy this repo uses — peer dependencies —
  is Cordis's and is not yet ported.
- **§7** — the evaluation, which is measurement of Cordis and not a claim about this port.

Two hypotheses the theorems carry that a real system can violate, both now detectable rather than
assumed: **`≺` acyclic** (Thm 73, Thm 80) is reported by `Registry.Cycles`, and **totality on the
provision** (Def 76, needed by Lemma 77 and hence Confluence) by `Registry.Total`. §6.1's
`Location.Guaranteed` is the third: a capability that recovers by *compensating* is outside the
metatheory entirely, because "the commutation of Definition 65 is proved against ≃ and has to be
re-established against the coarser one".

## Coherence with §6 — what the paper says we should have, checked against what we do

§7 is Related Work, so the paper ships no empirical evaluation to reproduce. What it does ship is
**§6, six sections of discussion**, and each one is a judgement about how this paradigm lands in a
real system. That makes §6 the coherence checklist, and this is that checklist run against the
implementation, against Cordis / Koishi / dsh, and against the product.

| § | the paper's position | Cordis / dsh | us | coherent? |
|---|---|---|---|---|
| 6.1 boundary | inside/outside per LOCATION; acquisition inside, emission outside; recover by withholding or compensating | — | `Location`, `Reify`, `Revertible`, `Guaranteed` + 5 properties | **yes** |
| 6.2 multiplexing | two routes for many providers of one key: exclusive binding, or a broker | Cordis has both; a broker absorbs the perturbation | **exclusive binding only** | yes, **with the cost the paper names** |
| 6.3 access control | declared-only access; static review at load; interception for policy; sandbox via bridge | `inject` + Proxy + external sandbox | `Deps.Use` → `ErrNotBound`; `Support`/`Cycles`; deny-list; bwrap | **yes, all four** |
| 6.4 language fit | needs closures + retractable loading; typed context extension; mediated access | TS: module augmentation + `Proxy` | Go has neither — **runtime mediation via `any`** | yes, **at the cost §6.4 names** |
| 6.5 cycles | predictable from declarations; report at load | — | `Cycles()` returns the ring's NAMES | **yes** |
| 6.6 typing/versioning | nominal linking alone admits interface drift and key collision; three remedies | **peer dependencies** (npm) | **none of the three** | **no — the one real gap** |

### 6.2 — we took exclusive binding, and the paper says what that costs

> "Exclusive binding: several implementations share one interface but at most one is bound at a time;
> the orchestrator selects which implementation is bound, and **switching between them requires
> unloading one provider and loading another, momentarily perturbing every consumer's dependency**."

The owner is that orchestrator; `plugin.NewResolver` refusing two live suppliers of one seam is
O-Insert's fourth premise enforced. The cost is real and now has a name: swapping a calendar
supplier takes every consumer of `calendar` through Unloading and back. The broker — "updating a
backing provider leaves the broker in place, so consumers see no change to their dependency and no
reload is triggered" — is unbuilt, and is the thing to build if that perturbation ever matters.

Given that block and supplier are near-static here, it does not matter yet. That is the same
judgement as *temporal is the reserve, spatial is what we use*.

### 6.3 — all four claims hold, and the third one names a feature we already shipped

1. *"a component can only access dependencies it has declared; an undeclared access raises an
   error"* → `Deps.Use` refuses a key outside `Requires` (`ErrNotBound`); property
   `TestAComponentCannotReachAnUndeclaredKey`.
2. *"declared statically … letting the orchestrator review and approve them at load time rather than
   discovering accesses as they happen"* → a manifest's `requires:` is the declaration, and
   `Support()` / `Cycles()` answer *what will run* and *what never will* before a step is taken.
3. *"an orchestrator can adjust it to constrain any component's access to a dependency **without
   modifying the provider** … since interception affects only how a dependency is invoked, not
   whether it is satisfied, it can be installed, reconfigured, or removed at runtime **without
   triggering any reload**"* → that is an **access code's deny-list**, exactly. And the no-reload half
   is enforced: `Intercept` is a derived realization with no inverse, and the loader's per-field
   dispatch does not rebuild on it.
4. *"the untrusted component runs in its own sandboxed context and reaches host-provided dependencies
   through a bridge … the bridge is an ordinary fiber whose capabilities can be attenuated"* →
   `TransportSandboxStdio` (bwrap) is the sandbox; per-tool `Requires` (`VisitorToolRequires`) is the
   attenuation.

### 6.4 — Go is missing both mechanisms, and we pay the price the paper quotes

**Temporal.** Closures, yes. But *"a component's code and the side effects of loading it must be
introducible and retractable at runtime"* — Go has no module registry and no `dlopen`/`dlclose`. We
do not meet that requirement **in-process at all**; we meet it at a coarser boundary, because a block
is an external process or MCP server, and retraction is closing the connection. That is a legitimate
reading of the same requirement ("loading object code into a running process and later detaching it"
with the process as the unit), and it is why `TransportStdio` / `TransportHTTP` exist.

**Spatial.** Both levels are absent in Go:

- type level — Haskell typeclasses, Rust traits, TS module augmentation all let a provider extend the
  context type *from its own module*. Go has no such mechanism.
- runtime level — JS `Proxy`, Python `__get__`. Go has neither.

> "Absent such a primitive, runtime reflection can mediate access dynamically, **at the cost of type
> safety and developer experience**."

That is the road we are on: `Table.Get(k) (any, error)`, resolved by name at runtime. The cost is
paid, knowingly. The paper's other exit — *"compile-time metaprogramming emits, for each dependency,
a typed declaration together with such an accessor"* — is codegen, which this repo already does for
sqlc and does not do for seams.

### 6.6 — the one place we are behind Cordis

Nominal linking admits two failures, and we have no defence against either:

- **interface drift** — a supplier changes what `calendar` means between versions while a consumer
  still declares `calendar`; `k ∈ dom(σ)` holds and the value no longer conforms.
- **key collision** — two independently developed blocks use `calendar` for unrelated interfaces, and
  nothing checks.

Of the three remedies, Cordis adopts **peer dependencies** and gets install-time version checking
from npm. We have `Manifest.Version`, but nothing constrains the version of a seam a block requires,
so we have taken **none** of the three.

**Why it does not bite yet, and exactly when it will.** Every manifest in the tree today is in the
tree — nine of them, written here, reviewed here. Key collision needs two independent authors, and
interface drift needs a supplier shipping on its own schedule. **Both arrive with a marketplace**
(`marketplace_install` already exists as an owner MCP op), and the cheapest of the three remedies to
adopt then is key namespacing: `K × P`, the seam name qualified by the package that defines it.

Recorded here rather than fixed, because fixing it before there is a second author would be inventing
a version constraint with nothing on the other side of it.

## What this does not do yet

The port is the mechanism only. **Wiring it to block install/uninstall is a second step**, and the
one that actually closes the measured gap: `blockstore` provisioning becomes an `Effect` whose
`Dispose` is the `Drop` that already exists and is already written for this purpose.

That second step changes product behaviour — an uninstalled block's data would be deleted rather than
orphaned — so it is called out separately rather than smuggled in with a refactor.
