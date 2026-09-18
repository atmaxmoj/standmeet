# Blocks panel UX — say "group", explain the flow, kill "fiber"

> **Status:** design, test-first build owed.
> **Why:** the owner opened the live blocks admin and could not read it. Three faults: no
> explanation of what a block is; the word **"fiber"** (an internal registry term) shows as a
> nav section and a graph the owner is asked to "assemble"; and it is unclear how a set of
> blocks attaches to a code. This plan fixes the **owner-facing layer only**.

## Grounding decision (recorded, not invented)

The owner-facing word for a set of blocks is **group**.
- `docs/design/plugin/frontend.md:62` — the assembler is "choose blocks, **name the group**".
- `docs/design/plugin/README.md:21` — plugin / fiber / group / bundle are dsh vocabulary adopted
  **internally**. They are plumbing words, not owner words.

So the owner sees one word — **group** — for the composable set. The words **fiber** and
**bundle** stay internal only where they are the wire/DB contract: DB tables (`bundles`,
`bundle_blocks`), op ids (`bundles.*`), the block graph op (`blocks.graph`), and the
control-driving e2e test ids (`bundle-panel`, `bundle-new-create`, `code-bundle-select`) keep
their names. Everything the owner reads — i18n **message keys included** — is renamed to "group":
the `fiber`/`bundle` message keys become `group`/`blockMap` keys (per the owner's "rename the keys
too"). This plan renames **no backend, no MCP op, no DB, no prod state**.

## One term, one meaning (owner-facing)

| owner sees | means | internal name (unchanged) |
|---|---|---|
| **block** | one ability the AI can use (search the corpus, book a slot, send mail) | block / fiber |
| **group** | a named set of blocks the owner assembles | bundle (`bundles` table, `bundles.*` ops) |
| (no "fiber") | — | fiber (registry term) |

"fiber" never appears in owner-visible text after this change.

## Work items

### A. Rename owner-facing "fiber"/"bundle" → "group" — values AND keys [DONE]
- i18n, all 8 locales (recursive key-parity guard stays green):
  - `admin-nav.section.fibers` key → `blockMap`; value → "block map" (zh printed the raw "fiber").
  - `admin-integrations.fibers` object → `blockMap` (empty/error).
  - `admin-integrations.blocks.*`: keys `bundlesKicker`→`groupsKicker`, `bundlesHeading`→
    `groupsHeading`, `bundlesIntro`→`groupsIntro`, `bundleNamePlaceholder`→`groupNamePlaceholder`,
    `bundleCreatedToast`→`groupCreatedToast`, `codeBundleLabel`→`codeGroupLabel`,
    `codeBundleNone`→`codeGroupNone`, `codeBundle`→`codeGroup`; values → "group" wording.
- `FibersSection.tsx` → `BlockMapSection.tsx` (function, `slug="blockMap"`, ns
  `adminIntegrations.blockMap`, testids `block-map-*`); route `app/admin/fibers/` →
  `app/admin/blockMap/`; nav slug `'fibers'`→`'blockMap'`. It draws the block dependency graph
  (`blocks.graph`) — labelled "block map", not "fibers". The component/slug/route/testid change; specs that
  name them in the same commit ([[design-column-boundary]] allows a test-id change with its spec).

### B. `?` tooltips — the explanations
- Add one small `HelpTip` component: a `?` button, focusable by keyboard, styled from the design
  palette, that reveals one plain-language line. No new dependency.
- Place it at three points, each with an 8-locale string:
  - **block** — "A block is one ability your AI can use. Turn a block on, then put it in a group."
  - **group** — "A group is a named set of blocks. Assemble one here, then attach it to a code."
  - **attach-to-code** — "Point a code at a group and it can use exactly those blocks — edited
    live, so removing a block reaches sessions already open."
- Copy is illustrative; the build settles the final wording.

### C. Attach-to-code clarity
- The code's group control (`CodeBundleBlock` / the group picker) states the mechanism in its
  label and carries the (B) tooltip. An owner reads how to attach a group without prior knowledge.

## Acceptance — 怎么算做完

1. `grep -ri fiber app/src/i18n app/src/components` returns **zero owner-visible hits** (code
   comments may keep the internal word). Chinese no longer prints "fiber".
2. "group" is the only owner-facing word for the composable set, across the blocks view, the
   assembler, and the code view.
3. block, group, and attach-to-code each carry a working `?` tooltip: it is visible, it is
   reachable by keyboard, and its text exists in all 8 locales.
4. A first-time owner reads the panel and can state, from labels and tooltips alone: what a block
   is, how to assemble a group, and how to attach a group to a code.
5. `make lint` is green, including the recursive i18n key-parity guard (8 locales match).

## Test plan (test-first, black-box)

| tier | spec | drives | asserts | gate |
|---|---|---|---|---|
| **GUI integration (NEW)** | `group-to-code-flow` | the **real panel controls**: assemble a group (pick 2 blocks, name it), attach the group to a code, open a visitor session on that code | the session exposes **exactly** the two blocks' tools, and nothing else granted only by the role — proving assemble → attach → use through the controls | always |
| **tooltip** | same spec | click/focus each `?` | the block / group / attach explanation text is revealed (a real marker, not "the element exists") | always |
| **anti-jargon guard** | a check-script or the spec | scan the rendered owner UI / built i18n | the owner UI shows "group"; the string "fiber" never renders to the owner | always |
| **regression floor** | `acl-bundle-additive` (existing, API-level) | the bundle→code binding via endpoints | stays green unchanged — the rename touches labels, not the binding | must stay green |

- The new spec is the gap the owner named: `acl-bundle-additive` drives the **API**
  (`createBundle` hits endpoints), so the **panel controls** — assemble, name, attach — have no
  e2e. This adds it ([[owner-facing-control-needs-ui-e2e]]).
- Assertions read the rendered marker a real user sees (a granted tool present in the session, the
  revealed tooltip text), never internal tables ([[e2e-must-be-blackbox]]).
- **Done = `group-to-code-flow` green through the real controls + `make lint` green.** No backend
  behavior changes, so no backend test churn.

## Scope boundary (deliberate)

Owner-facing only. If the owner later wants the **backend/MCP/DB** to say "group" too
(`bundles.*` → `groups.*`, the `bundles` table, the MCP golden), that is a separate, larger
migration against just-shipped prod — planned on its own, not folded in here.
