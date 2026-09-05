# Full e2e suite failures — 2026-09-04 round (1608 passed / 20 failed, 45.2m, 1 worker, chromium project)

> The previous round's triage (2026-08-02, 1168 passed / 14 failed) is in git history (this file is rewritten per round).

Archived evidence: `scratchpad/fullsuite2.log` (failure summary at lines 36734–37343, Playwright numbers the 20 blocks 1..20)
+ `e2e/test-results-archive/20260904T03*/` + `test-results/playwright/*/error-context.md` (page snapshots).
Diagnose **from the archive only** (error-context + backend.log + code + git history). Don't re-run, don't bare-docker.
**No "pre-existing" exemption — all 20 go green.**

---

## Batch A — homepage redesign fallout: the new `/` is a microsite, lost several page-shell "edges" | 5

**Root cause (proven)**: Slice 5 deleted the built-in homepage; `/` is now served by the custom `home` page. A few things
the old page-shell did on `/` were not carried onto the new surface: reading `?q=` and handing off to /gate, listing the
microsite deck, the shared footer, the TopBar with LocaleSwitch.

| # | spec | error (from log) | fix |
|---|------|----------------|-----|
| 1 | ask-about-this:44 | URL stuck at `…/?q=…`, expected `/gate?q=` | middleware: `/?q=` (no code) → app, not homepage; VisitorRoot: `?q=` with no session → `/gate?q=`. ✅ |
| 4 | integration-writing-chat-flow:38 | same `…/?q=…` | same single fix. ✅ |
| 2 | microsites-linked:92 | `microsites-deck` not found (`/`) | new homepage uses `PageNavWidget` (`page-nav-widget-link-<slug>`); test waits for homepage live + asserts the widget. ✅ |
| 3 | microsites-linked:100 | `footer-microsites` not found (`/`) | old shared Footer deleted; homepage discovery covered by PageNavWidget (#2) → footer case removed. ✅ |
| 10 | ui-locale-in-url:56 | `locale-switch` not found (page = HomeFallback) | switcher lives in the app TopBar (gate/reader); the custom homepage has no TopBar → test drives the switcher from `/gate`. ✅ |

**Status: fixed (single-spec green, pending batch REPEAT=5).**

---

## Batch B — Slice 5 removed the `page.get/put` op, but the parity tests still call it | 2

**Root cause (proven)**: backend `tool 'page.get' not found`. With the homepage now a microsite, the `page` resource keeps
only the two outward-address ops (handle / public URL); `page.get/put/pin/…` are gone; the owner-MCP parity tests still drive them.

| # | spec | fix |
|---|------|-----|
| 6 | owner-mcp-parity-mutations:212 | `checkPage` only tests `page.set_public_url`; drop the page.get/put roundtrip. ✅ |
| 7 | owner-mcp-parity-reads:185 | `checkOwnerSettings` drops the `page.get` step. ✅ |

**Status: fixed, verified green individually.**

---

## Batch C — inward golden stale | 1

| # | spec | error | root cause (proven) | fix |
|---|------|------|---------------------|-----|
| 5 | norm-inward-capabilities:93 | golden diff `+ resume.read` (Received +5) | `resume.read` (recruiter reads this application's résumé by code, job-loop B-7, commit 9b6a2447) was added to the registry but not synced into the golden | golden gains `resume.read` (in-host, ordered after `connector.agent_tools`). ✅ |

**Status: fixed, verified green.**

---

## Batch D — subjectivity local corpusSearch helper reads the wrong receipt shape | 1

| # | spec | error | root cause (proven) | fix |
|---|------|------|---------------------|-----|
| 9 | subjectivity-genre:51 | `TypeError: hits.some is not a function` | the local helper treated `body.result` as an array; `corpus_search`'s result is actually `{hits, note?}` (see fixtures/retrieval.ts) | helper reads `body.result?.hits ?? []`. ✅ (pending verify) |

**Status: fixed, pending verify + REPEAT=5.**

---

## Batch E — wiki reader refactor drift: c215f0be split the reader, tests didn't follow | 10

**Root cause (proven)**: `c215f0be fix(wiki): the reader shell lives in a layout` (before this session) rebuilt the wiki
reader. It **removed testids the tests still assert**, and changed the tree rail to `display:block` only at
`@media(min-width:1500px)` (the CSS comment spells out "why 1500 not 1280"). The chromium project viewport is 1280
(Desktop Chrome) and the tests mostly use 1280 → the rail is hidden; and `wiki-index` / `wiki-toc-resize` no longer exist
in the code. Deterministic red, red before this session.

Mapping from the refactored code:
- `wiki-index` → **removed**. The `/wiki` index now renders `WikiIndexRoots` (testid `wiki-index-roots`, or `wiki-index-empty` when empty).
- `wiki-toc-resize` → **removed** (the reader has no draggable resize handle any more).
- `wiki-topbar-reading` → **still exists** (WikiTopBar.tsx:72), so :35 is the rail/viewport, not a missing id.
- the rail (`wiki-toc`, the `styles.rail` aside) is `display:none` below 1500px → viewport must be ≥1500.

| # | spec | error | fix |
|---|------|------|-----|
| 12 | wiki-landing-extended:139 | `wiki-index` not found (/wiki index) | `wiki-index` → `wiki-index-roots` |
| 13 | wiki-landing-extended:153 | `wiki-toc` hidden (rail) | viewport 1512 ✅ |
| 14 | wiki-landing-extended:203 | `wiki-toc` visible, but `wiki-toc-resize` removed | drop the resize-handle assertion |
| 15 | wiki-landing-extended:277 | nested sidebar (rail/tree hidden) | viewport 1512 |
| 16 | wiki-reader-shell-persists:72 | `wiki-toc` hidden | viewport 1512 |
| 17 | wiki-topbar-reading:35 | rail hidden (topbar-reading id exists) | viewport 1512 |
| 18 | wiki-tree-stats:43 | `wiki-tree-stats` hidden (inside rail) | viewport 1512 |
| 19 | wiki-tree:145 | `wiki-tree` hidden | viewport 1512 |
| 20 | wiki-tree:146 | `wiki-tree` hidden | viewport 1512 |
| 8 | reader-scoped-gated-entry:73 | `wiki-index` not found | `wiki-index` → `wiki-index-roots` |

**Fix**: align the stale tests to the refactored reader — testid rename (`wiki-index` → `wiki-index-roots`), drop the
removed `wiki-toc-resize` assertion, viewport ≥1500 for the rail-dependent tests (the 1500 breakpoint is deliberate, so
the tests move, not the CSS). **No exemption.**

`wiki-topbar-reading` is the one **real regression** (not test drift): the refactor moved the shell into a layout and
dropped the `reading` prop (layout must stay URL-derived), so the topbar's reading tag never rendered. Fixed in the
product: WikiTopBar now derives `reading` from `document.title` on entry paths (`lib/visitor/use-reading-title.ts`),
the same URL-derived pattern the tree highlight uses — no per-article prop.

**Status: fixed.** 153 (viewport) + topbar (code) + 139/8 (`wiki-index-roots`) + 203 (drop resize) + 277/72/43/145/146 (viewport 1512).

---

## Batch F — after upgrade, the embed origin allow-list isn't enforced | 1

| # | spec | error (from log) | what's known |
|---|------|----------------|--------------|
| 11 | upgrade-embed-schema:115 | `sessionFromOrigin(CODE,'https://evil.example')` expected 403, got 200 | after the downgrade→restart upgrade, an embed pinned to ALLOWED origins was created for CODE, yet a session from evil.example is still let through |

**Root cause (proven)**: the **test asserts the wrong contract**. `sessionFromOrigin` sends a DIRECT plaintext code
(`{mode:'code', code}`, no `embed_token`). By deliberate design (`sessions_guard.go` `embedAuthBlocked` +
`[[embed-direct-code-stays-open]]`) a direct code connection is NOT origin-restricted — the allowlist gates only the
widget/`embed_token` path, and the job-loop QR flow requires a direct code to work from any origin. So 200 is correct;
`embed-direct-code-stays-open.spec.ts` + `embed-token-auth.spec.ts` already cover both halves.

**Fix**: exercise the allowlist through the token path, mirroring `embed-token-auth.spec.ts:149` — capture the embed's
`key_id`/`private_key` from create (proves the signing-key columns came up post-upgrade), `signEmbedToken` for an
off-allowlist origin, POST `/api/v1/sessions` with `embed_token` + that `Origin` → 403.

**Status: fixed.**

---

## Round status (2026-09-04)
All six batches green. Batch E+F rebuild: **41 passed**. Flake check `REPEAT=5` across all touched
specs: **205 passed, 0 flaky**. Final `make lint` caught one leftover parse error from Batch D's fix
(`subjectivity-genre.spec.ts:221` — a line terminator before `as`, which esbuild runs but
typescript-eslint rejects; [[host-lint-is-not-image-lint]]); fixed. Remaining gate: one full suite re-run.

## Closing rules (SOP, from this file's prior rounds)
- A batch is done only when `make test-only SPEC="<spec>" REPEAT=5` is all green.
- Inside a batch, only edit — don't run. At the batch boundary, once: `test-red` (prove red) → one dev build → one test-only (green) → one lint.
- **Run the full suite once, only after every batch is REPEAT=5 green.**
