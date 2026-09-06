# Composer v2 backlog — visual designer direction

**Decision (2026-09-06):** the owner reversed job-loop.md **L.9** ("一个 layout 一套字体，永远",
ATS-only). The resume composer becomes a **full visual designer** (TypstMe-style): drag layout,
font color, dividers, in-place edit. ATS-friendliness is no longer the hard constraint — the owner
chose experience over strict ATS determinism. Update L.9 in job-loop.md to record this reversal.

Findings came from the owner **using the composer on sijie** (real-usage QA), not from tests —
every item below is a gap the green test suite missed.

## Backlog (test-first each; batch by pipeline they touch)

- [ ] **A. CJK renders (not tofu).** Chinese/CJK text is tofu in BOTH the WASM preview and the
  server PDF — typst has only Latin fonts (Newsreader / JetBrains Mono). Add a CJK font (Noto
  Serif/Sans CJK) to typst's fallback on BOTH sides: template font lists + WASM font blobs
  (typst.ts) + server typst binary font dir (Dockerfile). [[right-bytes-wrong-glyphs]]
  *Guard:* render a draft with Chinese in a field → the SVG/PDF contains the glyph paths, no `.notdef`.
- [ ] **B. Period = two fields (start / end).** The composer form's RANGE is ONE input → maps to
  `period.start`, `end` always empty → template always prints "start – present". The template
  (`period(p)`) already handles `{start, end}` — only the FORM is wrong. Split into two inputs;
  empty end → "present". *Guard:* fill start+end → preview shows "start – end", not "– present".
- [ ] **C. Canvas drag-to-reorder (P3-b).** Drag a section ON the canvas → reorders + persists
  (reuse Phase-1 `reorder`). Today drag exists only in the side panel; the canvas is pencils-only.
  *Guard:* drag section B above A on the canvas → order flips → persists on reopen.
- [ ] **D. Declutter pencils.** Every page-1 field shows an always-on ✎ hotspot ("全是小铅笔").
  Reveal on hover/focus of the field region instead. Canvas-overlay only (does not touch the PDF).
- [ ] **E. Font color.** Owner can set text color (sanctioned by the L.9 reversal). Touches the
  template (`fill:`) + a color control + persistence.
- [ ] **F. Divider lines.** Owner can insert a horizontal rule between sections (`line(...)`).
- [ ] **G. Footer URL "水印".** The template footer prints the access URL as faint text bottom-right
  (`classic.typ` `footer:` → `#qr-url`), on top of the header QR. Owner reads it as a watermark.
  Make it optional / remove it (the QR already carries the URL).
- [ ] **H. Preview QR uses the internal host.** The preview placeholder URL came out as
  `http://app-…51.68.234.107.sslip.io/?code=app-…` (the Coolify internal host + http + no `/handle`),
  not `https://sijie.xyz/<handle>?code=…`. Check where the preview builds its placeholder qrURL (it
  likely uses `window.location` / the browsing origin) and what public-URL config the COMMITTED PDF's
  qrURL uses on sijie — a recruiter scanning the internal host resolves nothing. Verify committed vs
  preview separately.

## Re-imagined test matrix (owner: "这边的测试真的要重新想象，一点也不全面")

**Why the green suite missed everything:** every composer spec asserted on **plumbing** — a testid is
visible, an SVG element appears, an array reorders. NONE asserted on the **artifact**: what the
rendered résumé actually contains and looks like. So a suite stayed green while the real PDF had
tofu for CJK, dropped every `end` date, and crammed cards horizontally. The rule for this area:

> **Test the artifact, not the plumbing.** Read the rendered preview SVG text and the committed PDF
> text layer (`inspectPDF().text`), and assert the CONTENT and GEOMETRY — not that a widget mounted.

### The matrix (each row = one guard; RED must be reachable on the real defect)

| # | Guard | Mechanism | Catches |
|---|-------|-----------|---------|
| T1 | **Field-completeness sweep** — a unique sentinel typed into EVERY editable field (name, summary, contact ×4, each skill, each experience field {org, role, from, to, loc, every bullet}, each education {school, degree, from, to}, each social, each custom, cover letter) appears in the committed PDF text | fill via real inputs → commit → `inspectPDF().text` contains every sentinel | a silently-dropped field (the `end` bug); an adapter that forgets a field |
| T2 | **CJK / Unicode not tofu** — CJK sentinels in name + a bullet round-trip through the committed PDF text AND the WASM preview | commit → `inspectPDF().text` contains the CJK string; preview → SVG has no `.notdef`/missing-glyph diagnostic | the font gap (A) — server PDF + WASM preview both |
| T3 | **Preview ↔ PDF parity** — the same draft's WASM preview and committed PDF carry the same content (and, once fonts are unified, the same font family) | compare preview SVG text vs PDF text for the sentinels | "what you see isn't what you get" (preview uses typst defaults, PDF another font) |
| T4 | **Period semantics** — ended role → "start – end"; ongoing role (empty to) → "start – present" | fill from+to / from-only → PDF text | the `– present`-always bug (B) |
| T5 | **Canvas edit round-trip** — click a hotspot, type, blur → preview recompiles with the new value AND it persists on reopen | real click + type on the canvas overlay | in-place edit that updates state but not the draft |
| T6 | **Canvas + panel reorder → PDF order** — reorder (panel today, canvas after P3-b) → the committed PDF renders sections in the new order | reorder → PDF text order of section markers | reorder that's cosmetic and the PDF ignores |
| T7 | **Layout geometry** — sections stack (flex-col), nothing overflows the page box, cards are vertical | computed-style / bounding-box assertions | the horizontal-cram class ([[text-assertion-cannot-see-layout]]) |
| T8 | **Empty/partial draft** — a draft with blank fields renders empty regions, never "undefined"/"null"/tofu | commit a sparse draft → PDF text has no literal "undefined" | missing-data rendering |

**Build order:** T4 (guards B, cheap) → T1 (the sweep, highest value) → T2 (drives A) → T3 → T5/T6/T7
alongside C/D/E/F. Fold the one-off `draft-composer-period` into T4; retire narrow single-assertion
specs as their coverage moves into the sweep.

## Non-findings (verified real, keep)
- Side-panel drag-reorder: real HTML5 DnD, `draft-composer-reorder` genuinely GREEN (dragTo flips
  the array + persists on reopen).
- WASM render path: `draft-composer-wasm-preview` GREEN (data-status=ready, SVG, recompiles). The
  "渲染中" the owner saw was the 12.8MB compiler WASM loading on first open — slow, not hung.
  (Consider a clearer first-load indicator, low priority.)
