# The block model

Status: **2026-09-09.** What a block is, what kinds there are, when a block is allowed to be absent,
and what a visitor and an owner each see when one fails.

Vocabulary is adopted wholesale from Cordis/dsh — see `mechanism.md`. Using their words brought their
answers, and several questions that looked open dissolved once the words were right.

| term | meaning | whose |
|---|---|---|
| **plugin** | the atomic unit of code | Cordis |
| **fiber** | one loaded instance of a plugin, at runtime | Cordis |
| **service** | a capability published at a key on `ctx` | Cordis |
| **effect** | a registration that carries its own inverse | Cordis |
| **entry** | one row of a composition: `id` + `name` + `config` | loader |
| **group** | a set of entries that mount and unmount together; may carry a realm | loader |
| **realm** | a private resolution space for one service name | loader |
| **bundle** | a **distribution unit**: config rows *and* the code they mount. Most of what we call a "plugin" today is really one of these — `netfetch` is the fetch block plus a network grant | dsh |
| **seam** | a swappable capability: definition + provider + consumer | dsh |

## Where a block runs

Earlier drafts of this document swung between two extremes — "mounting means an ephemeral separate
process" and "every block is in-process" — and stated both in the same section without noticing.
Neither is right, because the split is not between blocks. **It is between two parts of one block.**

| | where |
|---|---|
| **the wiring** — what I require, what I publish, who wraps me | **one process, always.** This is what stacking is made of: a `ctx` is memory, and memory does not cross a process boundary |
| **the work** — actually doing the thing | **anywhere.** The block decides |

A block is a handle. What sits behind the handle is not the caller's business:

- our own adapter — runs right there;
- foreign code — the block spawns a sandboxed process, which dies when the call returns;
- **later, in the cloud** — the work moves to another machine and **the wiring does not change by one
  line**.

That last row is why this shape is worth having, and it is the owner's original reason for wanting
separate processes — obtained here for free. Changing where work happens is **swapping one block for
another**; no caller is touched. dsh does exactly this: their remote-sandbox filesystem package
replaces the local one, and every consumer is untouched.

**The sandbox is a tool a block uses, not a container a block lives in.** A third-party MCP server
is not "a block in a sandbox" — there is a block that spawns the server in a sandbox and republishes
its tools as a service. The confined thing is the server process.

**Ephemerality is a contract on the work, not on the block:**

> A block may not assume anything survives between calls. Anything that must survive belongs to the
> host.

We have paid for this rule twice already: a retry must be host-owned because a sandbox does not live
long enough to retry itself; per-session policy is a service, not config. What makes work
relocatable is that it holds no state — not that its process is short-lived.

The cold start is real and measured (`init=2158ms` for one Python MCP server). It is amortised with
**keep-alive scoped to a session, never to a server** — the session already has an owner, so the work
travels with it and relocatability survives.

## Who writes a block — REVISED 2026-09-10

**A block is a directory and a `manifest.yaml`. There is no Go in it.** The owner writes one and
installs it by pasting the manifest; a third party writes one the same way. Code, where a block has
any, is spawned at runtime through `transport` — stdio, http, or a sandbox — so it can be in any
language, and the host never imports it.

> This reverses the earlier claim on this page that *"a block is compiled-in Go, so a third party
> cannot write one."* It was overruled by the owner while this was being built, with a case the old
> claim cannot answer: **the owner makes a font block and uses it on their own microsite.** If
> installing a block requires a release, that owner has to wait for us to ship, and "adding a block
> costs no code" is true only for the people who own the repo.

Composition still happens at the **bundle** layer, which is the layer the owner works in — that part
is unchanged. What changed is that the layer below it is open too: a block with nothing but a
declaration (a font, a theme, a permission) is the smallest legitimate block, and the acceptance test
in `tests.md` installs exactly that.

Nothing about this reintroduces a privileged core. An installed block has no more authority than a
built-in one and gets it the same way — by what it declares and what the owner grants it — and the
`origin` it carries decides only one thing: whether the owner may remove it.

## The declaration — REVISED 2026-09-10, BUILT

There is no Go interface. A block is a **`manifest.yaml`**, and every property the Go sketch below
was reaching for is a field in it:

```yaml
id: calendar.book
title: Book a meeting
version: "1"
shape: both              # who it faces: visitor_only · owner_only · both
provides: calendar       # the seam it supplies, if any        (was: Provide)
requires: [calendar]     # the seams it consumes               (was: Inject)
visitor_tools:
  - name: calendar_book
    requires: [calendar:events.insert]   # per-TOOL, see "two levels" below
transport:               # how to start it — any language, or nothing at all
  kind: sandbox_stdio
  command: /plugin/booker
config:                  # the settings form, rendered generically
  - key: min_lead_days
    type: int
    default: "2"
    min: 1
```

Why data rather than an interface, spelled out because the Go sketch made it look like a style
choice: **a loader must read a declaration without constructing the block.** That is what lets a
manifest arrive as text the owner pasted, be validated, be stored, and be mounted — none of which is
possible if reading `Provide` means calling a method on a Go value that only exists because we
compiled it in.

`provides` / `requires` are the two halves of one relation, and both live in data. A consumer names a
**seam**, never a supplier: `calendar.book` says `requires: [calendar]` and never says "Google", so a
CalDAV block that also declares `provides: calendar` replaces it with no consumer touched. The
previous shape put that string in the composition root — `mail.send` declared `requires: [smtp]`
because `"smtp"` had been hand-written there — which welded one consumer to one supplier by an
accident of where the name was typed.

**Implemented**: `backend/internal/plugin/manifest.go` (the declaration),
`load.go` (`Load` for the shipped tree, `ParseManifest` for what the owner pastes),
`seam.go` (`provides` ↔ `requires` resolution, one supplier per seam enforced).

### `Config` — one schema, two jobs — SETTLED 2026-09-09

Every block declares the shape of its own configuration. Cordis validates it **before the plugin
starts** (`registry.ts`: *"Standard-schema validator applied to config before the plugin starts"*),
and dsh's blocks carry it as an ordinary export —
`packages/web/web-search-perplexity/src/index.ts:43`:

```ts
export const Config: z<Config> = z.object({
  apiKey:        z.string(),
  baseURL:       z.string(),
  model:         z.string(),
  maxTokens:     z.number().step(1).min(1),
  searchRecency: z.union(['day', 'week', 'month', 'year'] as const),
})
```

Go's equivalent is **JSON Schema**, which we already emit for MCP tools. The same schema does two
jobs and must not be split into two artefacts:

1. **validate at write** — a bad entry is refused when the bundle is saved, not discovered when
   someone clicks;
2. **render the settings form** — the admin draws it generically, so adding a block costs no
   frontend code (`frontend.md`).

The field kinds above are exactly what a form needs: a type, an enum, a range.

The four properties translate without the library (sketch in `backend/internal/plugin/`, tests
green):

| Cordis | Go |
|---|---|
| `ctx` derived by prototype (`context.ts:122`) | a struct with a `parent *Context` and an own-entries-only isolate map; lookup walks up |
| realm identity = a JS `Symbol` | a pointer to an opaque token, compared by pointer |
| `PENDING` until injects resolve | `epoch` = the concatenated uids of the providers bound to (`fiber.ts:611`); any missing → inactive, any swapped → reload |
| `ctx.effect()` returning its inverse | `Effect(setup) (dispose, err)`; disposers run in reverse, refused once unloading (`INACTIVE_EFFECT`) |
| service resolution through a `Proxy` | resolve by name. **Not** a typed accessor — see `architecture.md`: a typed category surface is exactly what the existing design kills |

**The `retry` example is withdrawn — REVISED 2026-09-10.** Every version of this argument used
`retry(3)` wrapping `google-calendar` as its flagship: neither knowing about the other, the vendor
called three times through the wrapper. The owner overruled it while this was being built — **each
block does its own retry** — and with that the example is gone. What remains true is the seam
relation itself, which is what actually ships: a consumer names `calendar`, a supplier declares
`provides: calendar`, and swapping CalDAV for Google touches no consumer. That is proven by
`supplier-provider-agnostic.spec.ts`, which is a real spec on the real stack rather than a
wrapping demo.

**What replaced the PENDING machinery.** Mounting is not staged: a block whose seam has no supplier
is simply not exposed, recomputed at every assembly rather than parked in a state. `enabledCaps`
(`internal/plugin/registry/registry.go`) walks the live registry on each call, so removing a supplier
— or a block from a bundle — takes effect on a session already open, with no draining and no
reload. That is the same guarantee PENDING was reaching for, without a lifecycle to get wrong.

**The duplicate-provider guard is enforced, and in data.** The mutation check that once left the
suite green (duplicates resolving by registration order, the wrapper happening to be last) cannot
arise: `plugin.NewResolver` refuses two suppliers of one seam at load, and the registry refuses a
colliding id first-wins. Two live providers of one name are a startup failure, not a race.

## "block" and "supplier" are not two kinds of thing — SETTLED 2026-09-11

Asked out loud — *why did we split block and supplier, when Cordis does not?* — and the answer,
checked against the code rather than recalled, is that **we did not**. What is left is vocabulary
that reads like a split, plus one interface that shares a word with it.

**One manifest, two directions.** `manifest.go` opens with "One shape, replacing two", and one
`Manifest` carries both `Provides` (manifest.go:85) and `Requires` (manifest.go:93). That is exactly
Definition 48's component `(d, p, e)`; a block with an empty `Provides` is a pure consumer, and one
with a non-empty `Provides` supplies a seam. Cordis is the same — a plugin both `inject`s and
`provide`s, and there is no second type for the supplying half.

**The split we did once have was the defect this design removed.** The two axes each had their own
descriptor and their own loader, and manifest.go:12 records what that cost:

> The consuming side said `requires: [calendar]` and the supplying side said `category: calendar`, so
> **the two halves of one sentence lived in two vocabularies** — and one of them, `"smtp"`, was not in
> a manifest at all but hand-written in the composition root.

Two names for one interface is §6.6's nominal linking problem, and merging the namespace is the fix.

**`adapters.Supplier` is a different thing wearing the same word.** It is three methods
(`adapters/supplier.go:23`), and only `Connected` asks a real question: *the owner installed a
calendar block* and *the owner authorised it* are two facts, and collapsing them is how a visitor is
offered a tool that will always fail. Its counterpart in the paper is **Definition 29's check on a
provision**, which Cordis spells as `provide(name, value, check)`:

```js
// reflect.ts, _checkImpl
if (impl.check && !impl.check.call(...)) return delete this._store[name]
```

A failing check deletes the binding from the store, so the key leaves σ_γ, so every dependent's
target view turns ⊥ and nothing activates against it. `Connected` is that predicate — not a second
species of plugin.

**Several suppliers for one seam does not break the single-source premise.** manifest.go:82 says one
seam may have several suppliers and the owner chooses which is live. O-Insert's fourth premise
(`p ∩ p_m = ∅`) looks violated until §6.2 names the arrangement — **exclusive binding**: "several
implementations share one interface but at most one is bound at a time; **the orchestrator selects
which implementation is bound**". The owner is that orchestrator, and `plugin.NewResolver` refusing
two live suppliers of one seam is the premise, enforced. The other route §6.2 offers is a broker,
which we have not built.

So: **one kind of thing with two declared directions.** Where this document and `effects.md` say
"supplier", read "a block whose `Provides` is not empty".

## A built-in is just a plugin somebody wrote early — SETTLED 2026-09-11

**The host must not be able to name a block that ships with it.**

Not "should avoid": must not. A built-in block has no standing an installed one lacks. It is
written ahead of time, its implementation lives outside the host (`mcp-servers/<name>`, started at
runtime like any other), and it reaches the host through the same loader, the same manifest and the
same host-op socket an owner's paste reaches it through. The moment host code names one, that block
stops being equivalent: the host does something for it that it will not do for the next plugin, and
the next plugin misses it in silence.

Silence is the whole cost. Every instance found on 2026-09-11 was green, shipped, and invisible:

| where | what it said | what it cost |
|---|---|---|
| composition root | `hooks := {"corpus.retrieval": {Fragment: CorpusScopeVisible}}` | a second block that reads the corpus misses the scope gate — its prompt fragment goes to a visitor whose scope reaches nothing |
| blocks table | `switch id { case "calendar.book": …; case "mail.send": … }` | exactly two blocks can say "needs X — not connected"; every other one says nothing |
| blocks table | two consts naming two shipped suppliers | `telegram` and `bearer-api` supply seams too, ship in the same image, and could never appear in the owner's table |
| api facade | `APICandidateBlocks() = {"corpus.retrieval", "calendar.book"}` | typed by hand beside a list that was derived, so the two could disagree and nothing would notice |

Each is now read from a declaration that already existed: `requires:` names the seam, `provides:`
names the supplier of it, `host_ops:` names what a block reaches for, `visitor_tools:` names what it
offers. The supplier's display name moved into the supplier's own manifest (`title:`) — a table of
names in the host is the same defect wearing a different hat.

**Enforced, not remembered.** `infra/scripts/check-host-blind-to-blocks.sh` reads the block ids out
of `backend/blocks/*/manifest.yaml` and fails on any of them appearing as a Go string literal
outside the declarations and the supplier layer. Its subject is derived for the same reason its
subject matter is: a guard holding a hand-written list of blocks is the thing it is guarding
against. Its self-test's third probe is exactly that — a block directory created on the fly, which
the guard must catch with no edit to itself.

**What is still inside, and why it is on the baseline.** Three protocol suppliers — SMTP, CalDAV,
Telegram — are compiled into the host and picked by a `switch m.Protocol`. That is the same defect
at the protocol grain rather than the id grain: the host ships three supplier implementations an
owner could not replace. Moving them out to `mcp-servers/` is a build, not an edit, so they sit in
`backend/.host-blind-to-blocks-baseline`, which only ever shrinks.

## The kinds of block

Trusted / untrusted is one axis. The second axis — **runs in the visitor's browser / runs on our
machine** — was missing from this design for several rounds, and the confusion it caused when
explaining the word out loud is the evidence that "block" was carrying too much.

| | example | has code | can be put in an iframe |
|---|---|---|---|
| **server-side block** | `google-calendar`, `calendar.book`, `netfetch` / `cagedfetch` | any language, our machine | n/a — bwrap instead |
| page block · **asset** | a font, an image | no | not needed |
| page block · **library** | a chart library, a date library | yes, called by the owner's code | **no** — it is in its caller's context |
| page block · **widget** | a review carousel, `CorpusWidget` | yes, renders and fetches for itself | **yes** |

The three page rows have different compartments, different distribution forms and different ACLs;
`isolation.md` handles them one at a time. What each row implies for distribution form, ACL and
lifetime is not yet written out.

## The floor

**The floor is exactly the set of blocks whose absence would make the page a lie.**

Derived, not chosen by taste: a page that has lost something it *promises* can no longer be
truthful, so the product says so instead of rendering. The gate is on the floor — a page offering
code entry with no way to enter one is lying. Traffic instrumentation is not — a page without it
still tells the visitor the truth. Quota metering and redaction get tested against the same sentence
rather than argued.

Residue: whether we additionally refuse to compose away something truthful that we want anyway
(instrumentation is the live example). That is policy, and small.

## Failure

**Outcome for the visitor, diagnosis for the owner.**

A visitor is told only when a failure changes what they can do or what they believe happened:

| when | the visitor sees |
|---|---|
| a capability fails to bind at session start | nothing — the tool is absent, so the agent honestly says it cannot |
| a page block fails to mount | nothing — the section is absent, as an empty section already is |
| a block dies mid-action while they wait | told, in outcome terms: "That didn't go through — nothing was booked" |

Never "an error occurred" for something they cannot act on; never a blank page. The one exception is
the floor case above, where the product says plainly that the page is unavailable.

For the owner: loud, persistent, **not conditional on a visitor hitting it**. Health is a state on
the bundle ("3 blocks failed to mount"), not a toast; the entry names the block, when it started,
and the reason **including the child process's stderr**.

## Unmount is immediate — DECIDED

**Unmounted means the visitor has no ability to call it.** The tool leaves the list; there is no
"try once more". A call already in flight fails, and the visitor sees what the failure rule above
prescribes — an outcome, not a cause. No draining, no timeout, no asynchronous unmount.

## What becomes of the dispatcher and hostdesk

Downstream of the two-kinds-of-block decision. A tree's root is a convergence point on its own, so
they look redundant — but untrusted blocks stay in separate processes, and something still has to
own that crossing (spawn, hand over, collect, time out). They most likely survive with a narrower
job: from "everything passes through here" to "the hop across a compartment boundary passes through
here".
