# corpus-render — Corpus: render faces on REAL content

- **Status:** ✅ verified (UPDATE, 2026-07-22) — F-R-3 CLOSED (root: rehype-sanitize stripped KaTeX inline styles; fixed by sanitize-BEFORE-katex + promoteDisplayMath; katex UT guards); all faces re-verified on the real reader incl. the bearer-aware invited path.
- **Module:** every heavy render face the real vault contains — KaTeX, mermaid, TikZ, callouts, `standmeet-query`, widgets, static pass-through — renders correctly through the reader / visitor-chat pipeline, plus owner CSS snippets + `cssclasses` land scoped and sanitized. Render timing doesn't regress.
- **Surface:** corpus reader + visitor chat markdown pipeline + admin note render.
- **Real dep:** the real vault (real `$$…$$`, ` ```mermaid `, TikZ, callouts, `standmeet-query` blocks; real `.obsidian/snippets/theorem-callouts.css`, `cssclasses:` notes).
- **Backing e2e:** `writing-math-mermaid` · `document-render` · `visitor-chat-answer-render` · `render-callouts` · `render-tikz` · `render-widget` · `query-render` · `query-errors` · `query-acl` · `render-static-passthrough` · `leverage-static-html` · `prerender-passthrough` · `render-cssclasses` · `cssclasses-surfaces` · `render-owner-css` · `owner-css-security` · `owner-css-bypass` · `owner-css-edit` · `document-render-benchmark`.

## Checks

### 1 — Render face on REAL content ⭐  (was §L10)
- **Steps:** render real notes end-to-end and check every heavy face:
  - **KaTeX** — real `$$…$$`/`$…$` render as math, no raw TeX leak, no ENOENT.
  - **Mermaid** — real ` ```mermaid ` fences render as diagrams.
  - **TikZ** — real TikZ blocks render via the underlying lib, no hang.
  - **Callouts** — real `> [!type] Title` → `blockquote.callout[data-callout=type]`.
  - **`standmeet-query`** — real ` ```standmeet-query ` blocks server-side-resolve into a live ACL-scoped list, not left raw; malformed DSL / unknown fields degrade (literal or friendly notice, capped); the query is **not** an authorization oracle (owner-only `subjectivity` never listed to a wiki-only visitor).
  - **`standmeet-html`/`standmeet-widget`** — sandbox iframe blocks render.
  - **Static pass-through** — Dataview/Templater pre-rendered on the Obsidian side ingested as static markdown and rendered whole.
- **Expected:** every face renders correctly on real content — no ENOENT, no hang, no sanitize-strip of legitimate math/diagrams, XSS still sanitized. **The second path most likely to break first on real data.**
- **⚠️ mock gap:** each render spec uses a single synthetic snippet; the real vault mixes all of these in one note with genuinely complex math.
- **Backing test:** `writing-math-mermaid.spec.ts` · `document-render.spec.ts` · `visitor-chat-answer-render.spec.ts` · `render-callouts.spec.ts` · `render-tikz.spec.ts` · `render-widget.spec.ts` · `query-render.spec.ts` · `query-errors.spec.ts` · `query-acl.spec.ts` · `render-static-passthrough.spec.ts` · `leverage-static-html.spec.ts` · `prerender-passthrough.spec.ts`
- **Result:** ✅ — real-notes render driven across the F-R-3 owner-iteration loop (headings/KaTeX display+inline/mermaid/images centered) and re-confirmed this re-pass on invited `/wiki/cybernetics` (full body render, 0 console errors).
### 2 — CSS snippet harvest from real `.obsidian/snippets/`  (was §L7)
- **Steps:** import with the real `theorem-callouts.css` + `appearance.json` enabled-list → owner CSS is **harvested** (not skipped). Confirm it's sanitized (strip `@import`/external `url()`/`expression`/`javascript:`) and scoped to `.corpus-content`, then renders on a published wiki note.
- **Expected:** safe rules survive sanitize+scope, apply inside `.corpus-content`, cannot touch app chrome; the enabled-list decides which snippets are active.
- **⚠️ mock gap:** fixtures feed a tiny synthetic CSS string; the real `theorem-callouts.css` is the first real-world sanitize target.
- **Backing test:** `owner-css-edit.spec.ts` · `render-owner-css.spec.ts` · `owner-css-security.spec.ts` · `owner-css-bypass.spec.ts`
- **Result:** ✅ (2026-07-22 prod) — the real vault's `theorem-callouts.css` IS harvested and served at `/api/v1/appearance.css` (2788B), scoped to `.corpus-content`. Observation (not a finding): the scoper also prefixes selector-like words INSIDE CSS comments (regex-based scoping) — harmless, cosmetically sloppy.
### 3 — `cssclasses` frontmatter  (was §L8)
- **Steps:** find real notes with `cssclasses:` frontmatter → confirm classes are captured on sync and re-emitted on the note container at render; verify tri-surface parity (sync-captured == admin note-edit `css_classes` == MCP write-tool `css_classes`).
- **Expected:** whichever surface set a class, the read-back is identical and the class lands on the note's render container.
- **Backing test:** `render-cssclasses.spec.ts` · `cssclasses-surfaces.spec.ts`
- **Result:** ✅ — e2e `render-cssclasses` guards capture+emit+tri-surface parity; live N/A-honest: the real vault carries no `cssclasses:` frontmatter (prod `corpus_notes.css_classes` all empty), so nothing to observe on this corpus.
### 4 — Render timing on heavy real notes  (was §L13, render half)
- **Steps:** time a representative reader render across the heavy real notes (loose upper bound, regression smoke).
- **Expected:** render timings don't regress sharply on real content.
- **Backing test:** `document-render-benchmark.spec.ts`
- **Result:** ✅ smoke — heavy real notes (cybernetics + the F-R-3-era math notes) render promptly on the prod reader; no timing regression observed this round.
### 5 — Currency `$` / `\$` renders literal, not garbled math  (guarded)
- **Steps:** render a note containing money on one line (`$80M on $246M`) and the vault's escaped form (`\$80M on \$246M`), plus a real inline math `$x^2$`.
- **Expected:** the currency renders as literal `$80M on $246M` (no inline math eaten between the two `$`, no leaked backslash); the real math still renders KaTeX.
- **Mechanism:** the pipeline is `escapeCurrencyDollars` (`markdown-helpers.ts:14`, auto-escapes `$`-before-digit; idempotent w.r.t. an existing `\$`) → `remark-math` (CommonMark-escape-aware, so `\$` is never a math delimiter) → rehype-katex. Not a hand-rolled `/\$…\$/` regex. Verified against the real react-markdown pipeline (2026-07-15).
- **Backing test:** `writing-math-mermaid.spec.ts` (asserts `\$80M on \$246M revenue` → literal; RED if remark-math is swapped for a `\$`-blind regex or `escapeCurrencyDollars` is dropped).
- **Result:** ✅ — guarded (UT + e2e from the F-R-3 family: escapeCurrencyDollars + promoteDisplayMath); the money-line garbling did not reappear across this round's real renders.
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
No raw markup leaking into rendered text (no bare `$$`, ``` ``` ``` fences, `[[`, unresolved `standmeet-query` blocks); math/diagrams actually render; no ENOENT/blank where a face should be. NB: **list EXCERPTS are a separate path** and DO leak markup — see [[corpus-raw]] F-R-1 (raw) and F-R-2 (wiki); the render pipeline here is clean, the excerpt-truncation is not.

## Findings
(record here; also log `../findings.md`, ID `F-L-n` historical anchor)

- **L10 KaTeX ✓** (first pass).
- **F-R-3 ⭐ ⬜ (new round, 2026-07-18)** — **single-line `$$…$$` display math renders as INLINE → tall
  equations overlap the text.** remark-math v6+ treats single-line `$$x$$` as inline; only fenced
  (delimiters on own lines) becomes `.katex-display`. Obsidian renders single-line as display and the
  real vault authors it that way (`lagrangian`: 6 single-line blocks → `.katex-display`=0, page
  collides). Backing `writing-math-mermaid.spec.ts` is GREEN only because its fixture uses the
  multi-line form — its own comment (L35-36) names the bug it dodges. Fix = preprocess single-line
  `$$` into fenced form (Obsidian-compatible). Inline KaTeX ✓, mermaid ✓, images ✓ — display block is
  the gap. Details in `../findings.md`.
- **F-L-11 ⭐ ⬜ (new round, 2026-07-18)** — **the reader empties + lies on an expired session.** After
  the 60-min visitor-session TTL, the frontend still shows "unlocked · CODE" from stale localStorage;
  `wiki-tree` falls to anonymous (published-only, 0 published) → empty tree + empty body, under a
  header (`getWikiTreeStats`, owner-scoped) still boasting "223 entries · 4 roots". Proven: a **fresh**
  `wiki://**` session returns the 4 roots — the ACL is correct; the bug is stale-session chrome +
  unscoped stats header. Full record in `../findings.md`. (Corrected the earlier UX-20 mis-attribution
  "reader ignores ACL" — it does not.)
- **Reader-navigation cluster (see [[vault-links]] F-L-12 / F-L-13):** in the same reader, `[[links]]`
  render as literal text and a folder-note's child sub-entries don't list — so a parent entry page is
  a navigation dead-end. UX siblings: **UX-22** (tab title "not found" on gated entries — SSR has no
  bearer) and **UX-23** (`> Parent: [[…]]` structure line leaks into the reader body).
