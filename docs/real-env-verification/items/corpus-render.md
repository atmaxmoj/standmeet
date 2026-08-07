# corpus-render — Corpus: render faces on REAL content

- **Module:** Every heavy render face the real vault contains — math, diagrams, TikZ, callouts, embedded queries, sandboxed widgets, pre-rendered static blocks — renders correctly through the reader and the chat pipeline. Owner CSS and per-note classes land scoped and sanitized. Timing does not regress on heavy notes.
- **Surface:** The corpus reader, the visitor chat markdown pipeline, and the admin note render.
- **Real dep:** The real vault, with its real math, diagram fences, callouts, query blocks, snippet CSS and frontmatter classes.
- **Backing e2e:** `writing-math-mermaid` · `document-render` · `visitor-chat-answer-render` · `render-callouts` · `render-tikz` · `render-widget` · `query-render` · `query-errors` · `query-acl` · `render-static-passthrough` · `leverage-static-html` · `prerender-passthrough` · `render-cssclasses` · `cssclasses-surfaces` · `render-owner-css` · `owner-css-security` · `owner-css-bypass` · `owner-css-edit` · `document-render-benchmark` · `markdown.katex.test.tsx`.

## Checks

### 1 — Every face renders on a real note, with nothing leaking as source ⭐
- **Steps:** Open several real notes that mix faces in one body. Read the whole body from top to bottom. Look for math, diagram fences, TikZ blocks and callouts. Then look for anything that arrived as source instead of as content.
- **Expected:** Math typesets, diagrams draw, TikZ renders without hanging, and a callout becomes a callout. No raw TeX, no visible fence markers, no leftover delimiter, and no words glued together where a delimiter was eaten. Sanitization strips scripts and leaves legitimate math and diagrams alone.
- **Mock gap:** Each render spec uses one synthetic snippet. The real vault mixes every face in a single note, with genuinely complex math, which is where the pipeline breaks first.
- **Backing test:** `writing-math-mermaid.spec.ts` · `document-render.spec.ts` · `render-callouts.spec.ts` · `render-tikz.spec.ts` · `markdown.katex.test.tsx`

### 2 — Money and math coexist on one line
- **Steps:** Render a line with two currency amounts. Render the escaped form. Render a line with real inline math starting with a digit.
- **Expected:** Currency stays literal, with no math eaten between two amounts and no stray backslash. Math starting with a digit still typesets. Both must hold at once, because a rule written for one has eaten the other before.
- **Backing test:** `writing-math-mermaid.spec.ts` · `markdown.katex.test.tsx`

### 3 — An embedded query resolves and does not become an oracle
- **Steps:** Render a note with a real query block, as the owner and as a scoped visitor. Then render one with malformed syntax and one referencing an unknown field.
- **Expected:** The block resolves server-side into a live list scoped to the reader. A visitor never sees an entry their scope excludes, not even its title. Malformed syntax degrades to the literal block or a friendly notice, capped in length.
- **Backing test:** `query-render.spec.ts` · `query-errors.spec.ts` · `query-acl.spec.ts`

### 4 — Owner CSS is harvested, sanitized and scoped
- **Steps:** Import with the vault's real snippet CSS and its enabled-list. Fetch the served stylesheet. Read what survived. Open a published note and check where the rules apply.
- **Expected:** Safe rules survive and apply inside the content container only. Imports, external URLs and script-like values are stripped. The enabled-list decides which snippets are active. Nothing can touch the app's own chrome.
- **Mock gap:** Fixtures feed a tiny synthetic string; the vault's real snippet is the first real sanitize target.
- **Backing test:** `owner-css-edit.spec.ts` · `render-owner-css.spec.ts` · `owner-css-security.spec.ts` · `owner-css-bypass.spec.ts`

### 5 — Per-note classes round-trip across all three surfaces
- **Steps:** Find or create a note with frontmatter classes. Sync it. Read the value back in the admin editor and through the MCP write tool. Render the note and inspect its container.
- **Expected:** Whichever surface set it, the read-back is identical, and the class lands on the render container.
- **Backing test:** `render-cssclasses.spec.ts` · `cssclasses-surfaces.spec.ts`

### 6 — Heavy notes render promptly
- **Steps:** Time the reader render on the heaviest real notes.
- **Expected:** No sharp regression against the previous measurement.
- **Backing test:** `document-render-benchmark.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Read a real note as a reader would, all the way down — this is where the product meets the owner's actual writing.
Anything that arrives as source instead of as content is a defect, and it will sit in the middle of otherwise perfect output.
Watch the spaces too: words glued together mark a delimiter that was consumed and never closed.
