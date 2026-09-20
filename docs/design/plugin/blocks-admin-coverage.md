# Blocks admin — feature floor, test coverage, and the real gaps

> **Purpose:** one place that says what an owner can do with a block, what is already tested
> (so we do not re-test it), and the few genuine gaps left — with a test-first plan for each.
> Written after reading the existing plugin/block e2e suite (~58 block-area specs).
> Companion: `blocks-panel-ux.md` (the group/tooltip/vocabulary work, already shipped).

## The feature floor — what an owner does with a block

A block is one ability the visitor's AI can use. Around it, the owner can: turn it on/off,
configure it, assemble blocks into a **group**, attach a group to a code, deny a single block to
one code, see a block's own **UI card** in the visitor chat, put a block on a **dock button**,
install blocks from the **marketplace**, and read the **block map** (dependency graph). Blocks are
sandbox-isolated. This is the floor; the rows below say how much of it is real + tested.

## How the machinery works — read this before calling something a gap

Three "gaps" in earlier drafts were not gaps; each came from reading a running instance's tool list
(v0.1.24) instead of the code. Fix the mental model here, once, so it stops happening.

- **The owner MCP toolset is the dispatcher's owner-plane ops, auto-projected.** `from_dispatcher.go`
  walks every op the dispatcher holds and grows each into an MCP tool — "no hand-written manifest to
  omit one from". So an op with `Reach: fp.OwnerAction()` / `fp.OwnerRead()`, once its `Resource` is
  registered in `wire/dispatcher.go`, IS an owner MCP tool. To decide whether a capability is on the
  MCP, read the op's reach + its dispatcher registration — NEVER a live instance's tool list, which
  may be an older release. (This is why `codes.set_bundle` needs no MCP wiring, and why `bundles.*`
  was already there.)
- **Owner-facing words differ from internal ones**, and the MCP uses the owner words: a **block** is
  `capabilities_*` + `capability_config_*` on the MCP; a **bundle** is a **group** in the owner UI
  and `bundles_*` on the MCP; the dependency graph is the **block map**, never "fiber". Same op,
  owner-facing name. `norm-outward-toolset` pins the whole owner toolset to a golden, so a newly
  registered op shows up there — that spec is the real answer to "is it on the MCP", not a probe.
- **A code narrows along three deny dimensions — block, skill, corpus — through ONE op pair**
  (`codes.add_denial` / `codes.remove_denial`, `kind` = block|skill|corpus). But they do NOT all
  bite the same way: **corpus** is orthogonal (`RoleSnapshot.AllowsCorpus`) and applies to every
  code, bundle-bound or not — which is why `CodeCorpusConfig` is universal. **block/skill** deny is
  part of the *role-based* grant model; a **bundle-bound** code's blocks come from the bundle
  (`mounted_gate.go` `granted()`: the two models do not merge), so a per-code block deny has no
  effect there. Take a block off a bundle-bound code by editing the group, not by denying it (G2).
- **A block inside a microsite runs over the visitor's session**, so it returns data only after the
  reader establishes one at `/gate`; `?code=` alone does not (G5). `useBlockTool` reports this via
  `granted:false`, and the widget must render it in words, not a dead button.

## Coverage today

Legend: **GUI** = a real admin control, e2e-driven. **MCP** = an owner MCP op. **usage** = the
runtime effect. ✅ strong · ⚠ thin/one-sided · ❌ missing.

| # | Feature | GUI | MCP | usage | key existing specs |
|---|---|---|---|---|---|
| 1 | enable / disable | ✅ | ✅ | ✅ | `block-enable-disable`, `block-relied-lock`, `block-unmount-is-immediate`, `block-disable-while-attached`, `active-only-self-made-fiber` |
| 2 | per-block config | ⚠ one GUI spec | ❌ no config-op spec | ✅ | `block-costs-no-code` (paste decl-only block → settings form → value kept) |
| 3 | group (bundle) assemble | ✅ | ❌ no `bundles.*` MCP | ✅ | `block-acl-is-a-list`, `group-to-code-flow`, `acl-bundle-additive`, `session-block-bundle`, `upgrade-bundle-includes` |
| 4a | attach group at code **creation** | ✅ | ✅ (`codes.create` bundle field) | ✅ | `group-to-code-flow` |
| 4b | attach/rebind group on an **existing** code | ❌ | ❌ | — | *(spec `group-attach-existing-code` is a RED draft — feature unbuilt)* |
| 5 | per-code deny one block/skill | ⚠ only via omission | ✅ (`codes.add_denial`) | ✅ | `acl-block-matrix`, `acl-skill-matrix`, `acl-frozen-product`, `acl-global-master`, `block-omission-fails-closed` (only GUI toggle) |
| 5c | per-code deny **corpus** | ✅ `CodeCorpusConfig` | ✅ | ✅ | `code-corpus-narrowing` |
| 6 | ui:// UI cards (MCP Apps) | n/a (block-owned) | n/a | ✅ | `visitor-ask-visitor`, `supplier-mcp-ui-tool-protocol`, `supplier-mcp-app-state`, `visitor-card-action-*`, `visitor-chat-book-card`, `microsite-block-widget` |
| 7 | dock buttons | ✅ | ✅ | ✅ | `dock-buttons-admin`, `dock-buttons-visitor`, `dock-buttons-mcp`, `dock-buttons` |
| 8 | marketplace / install | ✅ (skills) | ✅ | ✅ | `admin-marketplace-install`, `dsh-marketplace-install`, `dsh-reciprocity`, `dsh-market-live` (opt-in), `marketplace-needs-supplier` |
| 9 | isolation / native-key / sandbox | ✅ (realm, sandbox admin) | — | ✅ | `security-block-isolation-adversarial`, `block-realm-per-session`, `block-uninstall-drops-schema`, `real-third-party-mcp-sandboxed`, `sandbox-workspace-ttl-cron` |
| 10 | block map (dependency graph) | ✅ | ✅ | ✅ | `block-fiber-view`, `block-graph`, `block-panel-lists-all`, `block-dependency-greyed` |

**Works, don't rebuild:** rows 1, 3(GUI), 4a, 6, 7, 8, 9, 10 are strongly covered. In particular
the two things called out as "the old plugins could do" — **ui:// cards** and **dock buttons** —
are complete end to end (GUI + MCP + usage + e2e). Nothing here needs new work.

## The real gaps (ranked)

### G1 — [HIGH] Rebind a group on an existing code
No GUI, no MCP op. `CodeRepo.SetBundle`/`SetBundleByID` (incl. unbind) exist but are called only
from `codes.create`'s `bindBundle`. An owner who assembles a group *after* issuing a code, or
wants to move a code to another group, has to revoke and reissue — losing the code string and any
embeds keyed on it. This is the deeper half of "怎么挂到 code 上我没看懂": for an existing code
there is simply no attach control.
- **Plan (thin — reuse the repo method):**
  1. `codes.set_bundle` op (`{code_id, bundle | bundle_id}`, empty = unbind) over `SetBundle*`;
     admin route `POST /api/admin/codes/{id}/bundle`.
  2. A group picker on the code card (`CodeBundleBlock`) — set / change / unbind — testid
     `code-group-set-<code>`, with the attach `?` tooltip. Render it even when unbound.
  3. e2e `group-attach-existing-code` (draft exists, RED): assemble a group after issuing a
     group-less code → attach from the card → new session gets exactly the group's blocks →
     unbind → falls back to the role. Also add the `codes.set_bundle` MCP-parity assertion.

### G2 — [WITHDRAWN — the premise was wrong] Per-code block deny GUI
Built it, the e2e went red, and the red was right: **per-code block denial does not apply to a
bundle-bound code.** `mounted_gate.go` `granted()` is explicit — a code carrying a bundle IS granted
the bundle's contents, and "the role's `allowed_tools` and the per-code denials are the *other*
model … they stand side by side rather than merging." So `add_denial(kind=block)` on a bundle-bound
code changes nothing; a deny toggle in `CodeBlockList` (which only renders for a bundle-bound code)
is a button wired to nothing ([[button-that-cannot-be-wired]]).

Corrected model:
- **Take a block off a bundle-bound code** = edit the group (`bundles.remove_block`) or point the
  code at a different group. There is no per-code subtraction, by design (the additive model's whole
  point: the bundle is the list, read live).
- **Per-code block deny is a role-based-code capability** (`acl-block-matrix` proves it over a
  role-granted code). It is MCP-only, and a GUI for it would live on a role-based code's block list —
  which does not exist yet. That is separate, optional work, not this pass.
- **Corpus deny (`CodeCorpusConfig`) is different and correctly universal**: corpus is an orthogonal
  dimension (`RoleSnapshot.AllowsCorpus`); a bundle governs blocks, never corpus, so a corpus takeback
  bites on every code. Block deny and corpus deny are NOT the same shape — the original "inconsistent
  with corpus" read was the mistake.

Reverted here: the `CodeBlockList` deny toggle, `use-code-denials.ts`, the `blockDeny`/`blockAllow`
i18n keys, and `code-block-deny.spec.ts`. `CodeBlockList` is read-only again.

### G3 — [RESOLVED — was never a gap] Group assemble IS on the owner MCP
Corrected after reading `wire/dispatcher.go` + `from_dispatcher.go`: `BundleResource` is registered
in the dispatcher (`dispatcher.go:132`), its seven ops are all `OwnerAction`/`OwnerRead`, and the
MCP face auto-projects every owner-plane op ("no hand-written manifest to omit one from"). So
`bundles_create` / `bundles_add_block` / `bundles_set_includes` / … are already owner MCP tools,
and `norm-outward-toolset` (owner toolset ≟ golden) already covers them. The earlier "not on MCP"
read the v0.1.24 tool list, not the code — the same stale-instance trap as G5-fix1. Nothing to build.

### G4 — [RESOLVED — already covered, no new test] Per-block config
Re-checked `block-costs-no-code`: it drives config set → save → **reload-persists** through the
real GUI, which is the `block_config.set`/`get` op. The MCP `capability_config_*` tools are the
SAME ops (auto-projected), and `norm-outward-toolset` pins their presence in the owner toolset. So
config's set/get/persist logic is covered by a GUI e2e over the shared op, and its MCP presence by
the golden — a separate MCP-only config spec would re-test the same op with no new information
([[check-existing-coverage-before-new-test]]). Nothing to add.

### N1 — [note, not a gap] ui:// cards are owner-invisible by design
A block ships its card via `_meta.ui_resource`; there is no owner knob and no manifest
declaration, which is correct. Minor coherence idea only: the blocks panel gives no signal that a
block renders a visitor-facing card. Leave unless asked.

## G5 — [MED] Block-in-microsite discoverability (cold-reader A/B verified)

Two fresh agents, no repo access, were told only "use a block inside your microsite" and had to
work from product surfaces alone.
- **Agent A** (no extra hint, hit instance v0.1.24) reached the mechanism (`microsite.guide` names
  `BlockWidget` / `useBlockTool`) but stalled: a block page returned a **silent 401** and rendered
  blank — `granted` was not false and no `error` surfaced. It only recovered by reading the 401
  body and localStorage, discovering the page must be code-bound and unlocked at `/gate`
  (`?code=XXX` alone does not mint a session). 69 tool calls.
- **Agent B** (given the guide note below, hit prod v0.1.41) cleared the session step on the first
  try and rendered real corpus hits. 25 tool calls. The note is the fix that works.

**Fixes (ranked):**
1. **[real bug — root cause corrected after reading source] The no-session prompt sits on an
   unreachable path.** Agent A reported "granted not set false / silent 401" — the source
   (`BlockWidget.tsx`) shows otherwise: `useBlockTool` DOES set `granted:false` with no session,
   and `BlockWidget` renders `data-state="no-session"` + disables the run button. The real defect:
   the human-readable line `"no visitor session — open this page with an access code"` is only set
   inside `call()`, which fires from the run button's `onClick` — but that button is
   `disabled={!granted}`, so with no session `call` never runs, `error` stays null, and the visitor
   sees a greyed button with no words. ([[button-that-cannot-be-wired]] — the message lives on a
   path the disabled control can't reach; A hit v0.1.24 and read the grey shell as "blank".)
   Fix: `BlockWidget` renders the no-session line whenever `!granted`, not only after a click.
   One JSX branch; touches the SDK, so `make dev-rebuild-builder`.
2. **[doc] Add the session + arg note to `microsite.guide`'s BlockWidget section** (verified to
   unblock a cold reader): a block runs over the visitor's session, so a code-bound microsite must
   be unlocked at `/gate` first (`/p/<slug>?code=XXX` alone does NOT mint one); until then
   `useBlockTool` is `granted:false`; the visitor-side `corpus_search` block takes only
   `{query, limit, offset}` — no `genre`.
3. **[doc, still thin] Grant→block mapping is implicit.** Nothing says "`corpus_search` is granted
   only when the code's role carries `corpus_uris`." A corpus-less code yields `granted:false` with
   no in-product cause. Name the mapping in the guide.
4. **[doc] `autoRun` + gate interaction unstated** — an `autoRun` widget fires on load but only
   after the gate handoff; testing via `?code=` shows a silent no-op.

Not in this pass unless prioritized. Fix 1 is the only code change; 2–4 are guide edits.

## This pass — the exact changes

**Scope: close every real gap, then one full-suite sign-off.** Status by gap:
- **G1** (attach group to existing code) — code done (backend op + route + MCP auto + card picker).
- **G2** (per-code block deny GUI) — WITHDRAWN: the premise was wrong (a bundle-bound code does
  not take per-code block deny; the bundle is the grant). Built, e2e went red, reverted. See G2.
- **G3** (group assemble on MCP) — RESOLVED: already there, no code (see the machinery section).
- **G4** (config over MCP/API) — add one API-layer config e2e (GUI already covers the capability).
- **G5** — fix1 (no-session prompt) code done; fix2/fix3 in the guide; fix4 (autoRun) to add.

Implementation notes (where reality differed from the sketch):
- `codes.set_bundle` op is a standalone `setBundleOp(d)` (like `rotateOp`), because inlining it
  into `codeCoreOps` broke the revive function-length gate (75 lines).
- The code card picker's testid is `code-group-set-<code string>` (matches `code.code`, not the id).
- G5-fix1 root cause was corrected: `granted` already goes false; the real defect was the
  no-session line living on the disabled button's unreachable `onClick`. Fix renders it off the
  click path when `!granted` (testid `block-widget-no-session`).

**Backend**
1. `codes.set_bundle` op in `access/ops/codes.go` — `{code_id, bundle | bundle_id}`, empty name
   unbinds. Reuse `CodeRepo.SetBundle` / `SetBundleByID` (already exist; only the create path
   calls them today). Mirror an existing single-code op (`set_microsite`, `update_quotas`).
2. Admin route `POST /api/admin/codes/{id}/bundle` over that op.
3. Owner MCP tool `codes_set_bundle` — parity with `codes_create`'s bundle field, so the owner can
   also rebind from Claude, not only the GUI.

**Frontend**
4. `CodeBundleBlock` (today read-only) gets a group picker — set / change / unbind — testid
   `code-group-set-<code>`, carrying the existing attach `?` tooltip (`HelpTip id="attach"`).
   It renders even when the code has no group.

**Test rename (naming drift, no behaviour change)**
5. `git mv block-fiber-view.spec.ts block-map-view.spec.ts`; in it, rename the `describe` title,
   the comment header, and the owner identity (`fiber-view@example.com` → `block-map-view@…`,
   `fiberview` → `blockmapview`, "Fiber View Owner" → "Block Map View Owner"). The spec already
   drives `admin/blockMap` + `block-map-graph`; only its own name still says the old owner word.
   ([[vocabulary-must-not-diverge]] — the name was left behind by the UX rename.)

Internal "fiber" in other specs' comments/semantics stays (`block-graph`, `active-only-self-made-fiber`,
`block-relied-lock`, `norm-outward-toolset`, `security-block-isolation-adversarial`,
`block-delete-relied-refused`) — it is the registry word, not owner-facing (`blocks-panel-ux.md`
acceptance #1 allows it).

## Acceptance — the tests we run

**Done = every row green, in one run.**

| test | tier | proves |
|---|---|---|
| `group-attach-existing-code` | GUI e2e (NEW, the G1 spec) | assemble a group *after* issuing a group-less code → attach from the card → a new session gets exactly the group's blocks → unbind → falls back to the role. |
| `microsite-block-widget` | GUI e2e (G5-fix1) | granted → the block runs and renders; **no session → a visible "open with a code" prompt, no dead run button**. |
| `group-to-code-flow` | GUI e2e | assemble + attach-at-**creation** still works; owner UI says "group", never "fiber". |
| `block-map-view` (renamed) | GUI e2e | the block-map view still draws the dependency graph after the rename. |
| `acl-bundle-additive` | API | bundle→code binding via endpoints — the regression floor for G1. |
| `session-block-bundle` | API | a code's session is scoped to its bound group. |
| `block-acl-is-a-list` | API/GUI | a code = its group's block list. |
| `code-corpus-narrowing` | GUI e2e | the corpus deny control (the pattern G1's picker mirrors) still works. |
| `upgrade-bundle-includes` | migration | a bound group survives an instance upgrade. |
| `make lint` | gate | all backend gates + the recursive i18n key-parity guard (8 locales) green. |

How to run (test-first: `group-attach-existing-code` red before the build, all green after):
- Each spec in the table via `make test-only SPEC=<spec>` — one at a time (a parallel fan-out
  starves the one dev stack). `make test-only SPEC=group-attach-existing-code REPEAT=5` to rule out
  a flake on the new one.
- Then the gate: `make lint`.
- The full suite (`make test`) is the final sign-off, since G1 touches shared code
  (`access/ops/codes.go`, an admin route, the owner MCP toolset).
