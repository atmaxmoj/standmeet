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
*preview/edit* surface only, so what commits is never WASM-only output (injection-safety + the QR
stay server-owned; the WASM preview shows a placeholder QR exactly like the PDF preview does).

## Invariants (must not break)

- **Content is content.** Résumé fields are placed, never `eval`'d — same as the PDF path. The WASM
  editor edits the *structured `ResumeContent`*, then recompiles; it never lets a field inject Typst.
- **Server render is the source of truth.** The committed PDF is the `typst` binary's output; the
  WASM preview must render the *same* templates so WYSIWYG holds. One template set, two renderers.
- **The QR is system-owned.** Placeholder in the WASM preview; real code only in the committed PDF.
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
