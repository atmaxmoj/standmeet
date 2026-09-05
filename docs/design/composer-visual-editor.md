# Composer visual editor (typst.ts WASM, drag / in-place)

Status: **designed, not built** (2026-09-05). Owner: the composer's right pane is a read-only
Typst PDF; it should be a **TypstMe-style visual editor** — drag to reorder, edit in place — backed
by **typst.ts (WASM)** compiling in the browser. Test-first.

## The gap

Today: left = form panels, right = the real Typst PDF (`GET /drafts/{id}/preview.pdf`, an iframe).
The owner can't edit *on* the document — no drag-reorder, no click-to-edit-in-place. The render is
authoritative (server `typst` binary) but the editing is form-only.

## Why typst.ts

`@myriaddreamin/typst.ts` / `reflexo` is Typst compiled to WASM: it compiles a `.typ` + data to
SVG/canvas **in the browser**, instantly, no server round-trip. That's what makes drag/in-place
feel live. The **server `typst` binary stays authoritative** for the committed PDF — WASM is the
*preview/edit* surface only, so what commits is never WASM-only output (injection-safety stays
server-owned; the WASM preview draws the real selected code's QR client-side — see the QR invariant).

## Invariants (must not break)

- **Content is content.** Résumé fields are placed, never `eval`'d — same as the PDF path. The WASM
  editor edits the *structured `ResumeContent`*, then recompiles; it never lets a field inject Typst.
- **Server render is the source of truth.** The committed PDF is the `typst` binary's output; the
  WASM preview must render the *same* templates so WYSIWYG holds. One template set, two renderers.
- **The QR carries a real, existing code.** (Owner correction 2026-09-05: "不要place holder …
  永远真code".) The composer's code picker selects ONLY from codes that already exist (public /
  invited) and defaults to one — it never mints a code. The live preview draws that code's real,
  scannable QR client-side (qrcode-generator) and its real `<public_url>?code=<code>` URL, so the
  preview shows exactly what the recruiter scans. No placeholder anywhere.
- **What you see is what you send** — still true: edits persist (PATCH), commit renders the saved draft.

## Phased plan (each ships test-first, its own commit)

1. **Reorder without WASM (cheap, high-value).** Drag-to-reorder the repeatable sections
   (experience / education / social / custom) in the form panels; order persists (PATCH) and the
   PDF preview reflects it. Proves the reorder→persist→render loop with zero WASM risk.
   *Test:* drag row B above A → reopen → order BA; preview PDF regenerates.
2. **typst.ts preview (replace the iframe).** Vendor the WASM compiler (CSP: the artifact is
   inlined/self-hosted — CDN is blocked), compile the chosen template + `ResumeContent` client-side,
   render to canvas/SVG. Falls back to the server PDF iframe if WASM fails to load.
   *Test:* the composer shows a WASM-rendered page whose text matches the draft; template switch
   re-renders; WASM-unavailable → iframe fallback still shows the page.
3. **In-place edit on the canvas.** Click a rendered field → edit inline → writes back to
   `ResumeContent` → recompiles. Drag a whole section on the canvas to reorder.
   *Test:* click the summary on the canvas, type → the draft's summary updates + persists; drag a
   section → order changes + persists.

## Scope calls / risks

- **Big + risky:** WASM bundle size (CSP-inlined), template parity between the WASM and binary
  renderers (they must render identically or WYSIWYG lies), and canvas hit-testing for in-place edit.
- **Recommendation:** ship **Phase 1** first (real drag value, no WASM risk), then decide on Phase
  2/3 after seeing it. Phases 2–3 are the large part; Phase 1 is a few days smaller.
- typst.ts is an external dep whose CSP posture (self-hosted WASM, no CDN) must be verified against
  the artifact sandbox before committing to it.

## Implementation contract (established 2026-09-05, Phase 1 shipped)

Facts checked in the code, so the WASM path matches the server `typst` binary:

- **CSP:** the Next admin app sets NO Content-Security-Policy (only Referrer-Policy + embed.js
  CORS, next.config.ts). So browser WASM needs no `wasm-unsafe-eval` allowance, and a self-hosted
  `.wasm` loads from the app origin. The CSP that blocks CDNs is the *microsite/artifact* sandbox —
  the composer is not in it.
- **Fonts:** `RESUME_FONT_PATH` defaults to `""` and the backend image does NOT install
  Newsreader / JetBrains Mono (backend/Dockerfile) — the server renders with typst's DEFAULT fonts
  (the template's `("Newsreader","Georgia")` / `("JetBrains Mono","Menlo")` chains fall through).
  So the WASM preview should also use typst.ts's defaults — no font-binary loading for parity.
  (Follow-up: install the real fonts in BOTH the backend image and the WASM VFS for nicer output +
  true parity; out of scope for Phase 2 MVP.)
- **Render contract** (resumepdf/render.go): the chosen template is `main.typ`; it reads
  `json("data.json")` (the marshalled ResumeContent — `draftToAPIContent(model)` on the client),
  and `sys.inputs.at("qr"|"role"|"company")`. The QR is a staged `qr.png` the template `image()`s
  when the qr input is set. The WASM VFS carries: `main.typ` (= templates/<name>.typ, bundled
  client-side), `data.json`, and a `qr.png` the client draws (qrcode-generator → canvas → PNG) for
  the SELECTED real code, with the `qr` input set to `<public_url>?code=<code>`. role/company come
  from the draft. (Implemented: typst-preview.ts + use-composer-code.ts.)
- **Templates:** `classic.typ`, `compact.typ` live in backend/internal/owner/jobs/resumepdf/
  templates/. Phase 2 bundles their text into the app (single source: a build step copies them, or
  they're vendored) so the WASM compiles byte-identical templates.
- **typst.ts API:** `@myriaddreamin/typst.ts` + `-ts-web-compiler` (compiler wasm) +
  `-ts-renderer` (svg renderer wasm). Compile the mapped VFS → SVG; render SVG into the preview
  pane. SVG carries the text, so e2e can assert the draft's text appears.

### Phase 3 in-place edit — approach

Map a click on the rendered SVG back to a ResumeContent field via typst introspection: annotate
each editable region in the template with `#metadata(<field-path>)<label>` and use typst.ts `query`
to get each label's page position + the field path. Overlay a positioned contenteditable/input on
that box; on edit, write the field back to the DraftModel and recompile. Dragging a whole section
on the canvas reuses the Phase-1 `reorder` on the same field arrays. This keeps content structured
(no eval), same as the PDF path.

#### Status (2026-09-05): BLOCKED on typst.ts query — reverted, not shipped

Phase 3 was built end-to-end and reverted because the introspection step doesn't work in the
browser with **typst.ts 0.7.0**:

- The template side is correct. `#let edit-anchor(field) = context { let p = here().position();
  [#metadata((field: field, x: p.x/1pt, y: p.y/1pt, page: p.page)) <sm-edit>] }` before each field,
  compiled with the SERVER `typst` binary, `typst query main.typ '<sm-edit>' --field value` returns
  exactly `[{field,x,y,page}, …]`. The page is 612×792pt = the SVG viewBox, so a pt anchor maps
  straight into the rendered SVG box.
- typst.ts's `query` fails with **"document is not compiled"** in every form tried: the `$typst`
  snippet's `query` (it `reset()`s the compiler first), the low-level `compiler.compile()` +
  `compiler.query()`, and `withIncrementalServer` + incremental `compile()` + `query()`. `world.query`
  reads the world's *current* document and none of these leave one set for it in the browser build.
  `IncrementalServer` exposes no `query`. So the anchors always come back `[]` → no overlays.

Built (and reverted, resurrect from git around this date): `edit-anchor` in both templates;
`typst-preview.ts` renderResume+queryAnchors; `use-svg-geometry.ts` (measure the SVG, `anchorToPx`);
`EditOverlays.tsx` (✎ hotspots + inline editor); `EDITABLE_FIELDS`/`readField`/`applyFieldEdit` in
draft-model; `draft-composer-inplace-edit.spec.ts`.

**Paths forward (owner to choose):**
1. **Server computes anchors** (recommended, sidesteps the bug): the backend already has the typst
   binary + templates and `typst query` WORKS. Add an endpoint that returns the `<sm-edit>` positions
   for a draft; the client overlays them on the WASM SVG. Risk: the server binary and the WASM
   renderer must lay out identically (both use typst defaults today — verify, or install the same
   fonts in both so positions match exactly).
2. **DOM text-layer positioning:** place an invisible marker per field and find it in the WASM SVG's
   text layer (`getBBox`) — no typst query. Risk: depends on how typst.ts emits glyphs.
3. **Bump typst.ts** to a version whose in-browser `query` works, then the reverted code drops back in.

### Test matrix (e2e, test-first)

- P2-a: composer preview shows a WASM render whose SVG text contains the draft's name + company.
- P2-b: switching the template picker re-renders (compact vs classic differ in the SVG).
- P2-c: WASM-unavailable (init fails) → falls back to the server-PDF iframe, page still shows.
- P3-a: click the summary on the canvas, type → the draft's summary updates + persists (reopen).
- P3-b: drag a section on the canvas → order changes + persists (shares Phase-1 reorder).
