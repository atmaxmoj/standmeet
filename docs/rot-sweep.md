# Rot sweep — where the code moved and its description didn't

**Date:** 2026-07-17. Prompted by: `/admin/skills` vs `/admin/agent-skills` reading as two things
when they are one.

## The class

Every real defect in the 2026-07-16/17 rounds is the same shape: **something asserts a state it
does not actually track.** Not crashes — confident labels over a different reality. Lint, tsc and
`next build` were green with every one of them live, because they check **shape** and the lie lives
in **semantics**.

Four sub-shapes, each with a way to hunt it:

| shape | how it rots | how to find it |
|---|---|---|
| a comment/label claims "mock / temporary / pass-1" | the real thing landed; nobody edited the comment | grep for mock/临时/pass-1/先用/TODO-wire, then verify each against the code it describes |
| a **test** encodes a behaviour the product deliberately changed | the product moved with a reasoned commit; the spec stayed green because it tested the old thing on a path that still existed | a full run's failures ARE this list — read each against the current design |
| **fabricated data** rendered as if measured | shipped as a placeholder "until the endpoint lands"; the endpoint never landed | grep for derive*/mock*/simulated in render paths; ask "where does this number come from?" |
| **config that does nothing** | an option silently exempts the thing the neighbouring option lists | test the config against a probe, don't read its docs |

## Found and fixed

### 1. `/admin/skills`'s "corpus-inferred skill heat graph" was **fabricated** — REMOVED
`deriveHeat(index, total) = 95 - (index / (total - 1)) * 70`. The "heat" was **the skill's index in
the list**; `deriveRole` then labelled each one `core` / `strong` / `maintained` / `developing` /
`dormant` from that number. The first skill was always "core", the last always "dormant". Zero
relationship to the corpus — while the header called it "corpus-inferred" and the design intends it
to drive **job-loop matching**, i.e. the owner makes decisions on it.

Not "mocked pending an endpoint" — a chart asserting a measurement that never happened. There is
still no corpus-stats endpoint, so it now renders its empty state (`HeatEmpty`), which the component
already had. **No chart → the owner asks for one. A fake chart → the owner believes it.**
The whole fabrication chain is gone (`deriveHeat`/`deriveRole`/`HeatRow`/`HeatBar`/`HeatBarFill`).

### 2. `AgentSkillsSection`'s "Pass-1 ships with mock data" — CORRECTED
Stale since #48-5 replaced the mock with real endpoints (`GET /skills/`,
`/marketplace/search|install|install-manual`). `use-agent-skills.ts` line 1 says "the Pass-1 mock is
gone"; the section header two files away still said the opposite. A stale comment is worse than none:
it tells the next reader this area isn't wired.

### 3. Six specs encoding a landing page the product abandoned — FIXED
`/admin` server-redirects to `/admin/dashboard` (deliberate, with a reasoned comment in
`app/admin/page.tsx`). `claim-instance` + `setup-wizard-4step` still waited for `**/admin/page`;
`public-url-edit`, `page-edit`, `page-edit-full` still assumed the fixture lands in the page editor.

### 4. `sync-a-routing`'s "empty vault → created 0" **contradicted** `sync-d-publish` — FIXED
F-L-8 settled that `publish` is a **visibility** gate, not an intake gate (the old semantics cost
173 of 223 real wiki leaves — none of them declare `publish:`). One spec守 the new law, the other
still asserted the old one **and was green**, because it tested a path that still existed. The case
was even named "an empty vault" for a vault holding a note. Renamed + inverted.

### 5. `norm-visitor-assembly`'s golden was 3 tools behind — FIXED
`corpus_map` / `corpus_resolve` / `corpus_peek` (the nav trio on top of search/read/list/links) are
deliberate, and ACL-scoped (`corpusScopeOf(req)`). The golden hadn't been updated — which is the
one thing a golden exists to force. Adding a line to that list must stay an explicit act of
admitting the visitor got another tool.

### 6. The i18n lint's `ignoreAttribute` list is **dead config** — DOCUMENTED
`markupOnly: true` (= `mode: 'jsx-text-only'`) checks JSX text only; **no attribute is ever
checked**, so the ~25-entry `ignoreAttribute` list beside it does nothing. Verified by probe inside
youteacher's own repo with its own config: `<span>bare text</span>` flags, `placeholder="ask me
anything"` passes. Same in Otium. Our config now says exactly what it covers and why widening is
gated (testid-derived-from-label). See the memory `i18n-lint-markuponly-exempts-attributes`.

## Found, NOT fixed — needs a product decision

### A. `/admin/skills` and `/admin/agent-skills` are two doors to one registry
- `use-agent-skills`'s `installed` **is** `use-skills`' data; `marketplace/install` writes through
  `h.SkillsAdmin.Skills.Skills` — the same repo, the same table.
- Sidebar: `skills` (under ACCESS) and `agent skills` (under INTEGRATIONS) — two groups, two
  near-identical labels, no clue in the UI that they are the same things.
- This is [[vocabulary-must-not-diverge]] at the surface layer: not two words for one concept, but
  **two entrances**.
- Proposal: one `/admin/skills`, with MY SKILLS / MARKETPLACE as its tabs (the tab structure already
  exists inside AgentSkillsSection). Requires a nav decision, so it is not done here.

### B. 28 comments cite `docs/design/project/admin.js` line numbers
`design 源 admin.js SkillsSection (1949-1969)`. Line numbers rot the moment the design file is
edited, and nothing checks them. Low severity, but they are unverifiable claims by construction —
cite the component name, not the line span.

### C. `SEOEditor`'s testid is still `${testid}-seo-indexed`
The concept was renamed `seo_indexed` → `published`. The other residues are legitimate (the backend
accepts `seo_indexed` as an old **frontmatter** name for real vaults; the specs document that
mapping). This one is just vocabulary drift in a testid.

## The lasting rule

A green gate is not evidence. The two things that actually catch this class:
**look at the page**, and **do the owner's action by hand**.
