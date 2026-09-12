# Plugin model — the block shape

Status: **2026-09-09.** Opened because the question "what is the right shape for connectors" kept
returning without an answer, and a study of DeepSeek Harness (`dsh`) and its plugin kernel (Cordis)
produced one worth writing down.

Read `mechanism.md` first, then `block-model.md` — the rest assumes their vocabulary.

| doc | what it covers |
|---|---|
| `mechanism.md` | What Cordis actually does, measured from its source. The four properties, and what each one costs. |
| `what-it-unlocks.md` | Function-first: what becomes possible for StandMeet, and for whom. |
| `block-model.md` | What a block is, where it runs, the kinds of block, the floor, failure UX, unmount. |
| `access-control.md` | Additive ACL over a bundle bound by reference; bundle nesting; sessions. |
| `isolation.md` | Permissions as atomic blocks; bwrap; and browser-side isolation (CSP, iframe, SES, the prior art). |
| `microsite-build.md` | Where node packages come from, what still gets built, where the supply-chain compartment sits. |
| `architecture.md` | Where the code goes: the kernel, blocks as peers, block vs library, how agent tools load. |
| `frontend.md` | What changes in `app/` and `sdk/` — and why the admin has the same star topology. |
| `tests.md` | What breaks by design, what is the safety net, and the claims that owe a test. |

**Vocabulary is adopted from Cordis/dsh wholesale** — plugin, fiber, service, effect, entry, group,
realm, bundle, seam. Deliberate: borrowing the words brought their answers, and several questions
that looked open dissolved once the words were right. The table is in `block-model.md`.

## Why this was opened

Two long-standing complaints, and one observation that connects them.

**The complaint.** The connector axis "never found a good shape". Adding a provider is cheap (an
OpenAPI manifest); adding a *category* means editing our composition root. Cross-cutting behaviour —
retry, egress control, quota, approval, redaction — is welded into the core of each axis, so it
cannot be extended without touching us.

**The observation.** Every capability we ship is a **leaf**. Our plugin contract is one method:

```go
type Plugin interface {
    Name() string
}
```

A plugin receives nothing, so it can offer nothing. The star topology is not a limitation of Go —
it is the direct consequence of that interface. What `dsh` has instead is a block that receives the
same kind of thing it can hand on, so blocks stack.

## What this is NOT about

- **Not about adopting Cordis in the backend.** Cordis is TypeScript; our backend is Go. The four
  properties are portable (see `mechanism.md`); the library is not.
- **Not a migration plan.** No sequencing, no estimates beyond the route in `architecture.md`.

## What this does not touch

- **facade-parity is not involved.** `fp.OwnerAction()` / `fp.OwnerRead()` carry `plane: PlaneOwner`
  — they govern the **owner control surface** (AI client, GUI, API agreeing), a different surface
  from the visitor agent's toolset. An earlier draft confused the two.
- **Migration is small.** Capabilities already run as ephemeral separate processes, so moving to
  blocks changes the **composition layer**, not the runtime. The e2e suite is largely
  architecture-independent — asserting durable state is correct practice, not coupling — so the
  expected edit is narrow: specs that reached for internal state because a behaviour had no
  observable surface get pointed at the surface the block now exposes. The ACL matrix changes by
  design, because the rule changed (`access-control.md`).

## Source material

- `~/Develop/reference/deepseek-harness` — full clone, 16,351 commits (2026-06-10 → 2026-09-09).
  Kernel at `vendor/cordis/src`, nine files, 2,693 lines.
- Vault notes: `wiki/dsh/` (seven nodes) and `wiki/software/untrusted-build-bulkhead.md`.
- The measurements in these docs come from that clone and from our own tree, not from anyone's
  documentation. Where a secondary source disagreed with the code, the code won — three times.

## Corrections carried forward

Claims made and withdrawn while assembling these docs, kept so they are not re-made:

- **"Cordis needs JS prototypal inheritance, so Go can't."** It reduces to a parent-linked map plus
  identity comparison on an opaque token — about twenty lines of Go.
- **"We only have four connectors, so the machinery isn't worth it."** Circular: the count may be low
  *because* each one is expensive.
- **"Our e2e suite knows too much about the implementation."** From counting instead of reading.
- **"Retry is written twice, once per axis."** It exists on the connector axis only; quota exists on
  the capability axis only. The cost is not duplication, it is that each behaviour is trapped on the
  side where it was born.
- **"facade-parity is disturbed by this."** It governs the owner control plane, a different surface.
- **"The SDK's public API has to move."** `@standmeet/sdk` is for embedding into someone else's site;
  how microsites compose internally does not reach it.
- **"Can a bundle reference a bundle?"** Malformed — the result is simply a bundle.
- **"Vercel's build model is the one to copy."** Wrong reference class. It isolates mutually hostile
  tenants; we are single-owner.
- **"Every microsite needs a build compartment."** A composition of blocks is data. Most microsites
  have no build at all; the compartment belongs at **block install**, once per block.
- **"We need to design a materialise/build split."** It exists — `builder/runner.mjs:76`. Two turns
  of design ran without reading `builder/`.
- **"Self-host esm.sh."** Only needed if we resolve npm ourselves. Blocks carry built dists.
- **"A library sharing the page has no runtime defence."** LavaMoat/SES is exactly that defence and
  runs for tens of millions of MetaMask users. It is hardening rather than isolation, which is a
  reason to rank it below CSP — not a reason to call it nonexistent.
- **"A library needs no compartment — it shares the owner's fate."** It **cannot have** one, which is
  a constraint, not a judgement. The first phrasing invites the reader to relax; the second sends
  them to build-time.
- **Four turns spent arguing about "stealing the token" without reading what the token was.** The
  valuable secret turned out to be the visitor's own API key, already defended in `byoai-vault.ts`.
  The question that ended it was the owner's: *"can you look at what we actually put in the
  cookie?"* — and the answer was that there is no visitor cookie at all.
- **One `decisions.md` grew to 607 lines covering eight subjects**, with settled items filed under
  "Still open". Split into the files above on 2026-09-09. The failure mode was appending each new
  conclusion to whatever section was nearest.
- **"Mounting means an ephemeral separate process"** and **"every block is in-process"** were both
  written, in the same section, without noticing they contradict. Neither is right: the wiring is in
  one process, the work is wherever the block puts it (`block-model.md`).
- **A privileged core.** "Ours runs in-process, theirs runs sandboxed" is the star topology
  reintroduced as a caste system. All wiring is in-process; a sandbox is a tool a block uses.
- **An `internal/blocks/` package collecting every block.** The star topology again, as directories:
  one central place to edit whenever anything is added. Domains stay where they live
  (`architecture.md`).
- **A public `backend/plugin/`.** The substrate is a loading mechanism, not a published contract —
  becoming a block is carrying a declaration, not implementing a Go interface. What is public is the
  data, and `backend-domain-modules.md` already put it outside `internal/`.
- **`Use[Calendar](ctx, "calendar")`.** A typed accessor is the typed category surface that
  `backend-domain-modules.md` explicitly kills. Resolve by name; call with opaque JSON.
- **Keeping a top-level `connectors/` directory.** Copied forward while reading the old design,
  after this design had already merged the two axes. The split survived in the filesystem for a
  round after it was removed from the model.
- **A `plugins/` source directory beside `blocks/`.** Two names for one concept, because a source
  tree and a runtime store were drawn at the same level. An installed block is not in the
  repository at all.
- **"A block declares on its manifest that it is an agent tool."** The second axis, rebuilt. dsh has
  no such field: a tool plugin injects the `tools` service and registers into it, the same
  dependency mechanism as anything else (`architecture.md`).
- **"`capreg` shrinks to rendering a bundle into a tool list."** Still a special-purpose piece of
  code for one class of block. There is nothing to render — the list *is* a service.

- **"The owner's MCP surface becomes blocks, so facade-parity is back in play."** The two MCP
  surfaces confused again: the owner's AI client reaching the product's own API
  (`fp.OwnerAction()` / `fp.OwnerRead()`, parity-governed) is **not** the visitor agent's toolset.
  Only the second is made of blocks. Today's `capreg` holds both, which is where the confusion comes
  from — it is a defect in the current code, not a question for this design. This correction had
  already been recorded once and was then re-broken.

- **facade-parity, raised a third time.** It is not involved, and never was: owner operations must
  agree across the AI client, the GUI and the API — before this change and after it, unchanged. The
  trigger each time was **seeing `facadeparity` imported in a file being read** (`axisconn/ops.go`,
  `axiscap/claims_test.go`) and converting *present in this code* into *affected by this change*.
  Two earlier entries recorded the conclusion and did not stop it; this one records the trigger.
  **A package appearing in a file you are reading is not evidence that your change touches it.**

**The recurring move behind three of these**: giving one class of block a slot no other block can
fill — a trust level, an "I am a tool" flag, a `SessionGate`. Whenever that appears, the two axes are
back under a new name.
