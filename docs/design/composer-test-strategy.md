# Résumé composer — complete test strategy

Owner directive (2026-09-06): "停下来好好想一下完整的测试策略，把所有的状态和验证点都想好了，然后开始写测试
… 至少要二十多个测试 … 看看现有测试，集合着一起弄." This doc is that strategy. Write no new composer
test until this list is agreed. Source inventory: the 23 existing specs (see composer-v2-backlog.md).

## 1. The one rule

**Test the artifact, not the plumbing.** Assert what the rendered résumé CONTAINS and how it LOOKS,
not that a widget mounted. The suite stayed green through three shipped regressions (CJK tofu, dropped
end-dates, wrong-host footer URL) because ~3 of every 4 assertions checked a testid / HTTP status /
form value, and the artifact side sat in one spec (`resume-pdf-render`). Every fidelity guard below
reads a rendered surface.

## 2. The surfaces (where truth is read)

| Surface | What it is | Read with | Authority |
|---|---|---|---|
| **PDF** | the committed résumé — what a recruiter gets | `inspectPDF(buf).text` / `.pages` / `.pageWidthPt` | **authoritative** |
| **PREVIEW** | the owner's live WASM edit view | `composer-preview-svg` `.toContainText` / geometry | must match PDF |
| **THUMB** | the drafts-list card (React `<ResumePage>`) | DOM text | a third render — keep thin |
| **FORM** | composer inputs | `toHaveValue` after reopen | round-trip only |
| **API** | MCP / HTTP draft lifecycle | tool result / status | lifecycle only |

Fidelity (content, glyphs, period, layout, URL) is asserted on **PDF** and **PREVIEW**. FORM/API specs
stay for round-trip and lifecycle, consolidated and kept thin.

## 3. States to cover (the axes)

- **Content fill:** empty · partial (some sections blank) · full (every field) · long (body forces page 2).
- **Script:** Latin · CJK · CJK+Latin mixed.
- **Period:** ongoing (end empty → "present") · ended (start+end) · both in one draft.
- **Cover letter:** present (2pp) · absent (1pp).
- **Template:** classic · compact.
- **Code/QR:** new code · existing code · none (placeholder) · host = public_url.
- **Edit:** in-place ✎ · panel drag-reorder · canvas drag-reorder (P3-b) · add/remove row · from/to fields.
- **Lifecycle:** manual create · update (stable id) · discard · TTL expiry · SEND/commit.
- **Visual-designer (new):** font color · divider line.

## 4. The consolidated suite (~24 guards)

Disposition: **NEW** · **REWRITE** existing · **EXPAND** existing · **KEEP** · **MERGE** · **RETIRE**.

### Group A — committed-PDF fidelity (surface: PDF)
- **A1. Full-field sweep.** Every editable field gets a unique sentinel → commit → `inspectPDF().text`
  contains all: name, email, phone, location, site, summary, BOTH work entries (title/company/location/
  every bullet), education (school/degree), every skill, every social handle, every custom label+value,
  cover-letter body. → REWRITE `resume-pdf-render` field checks (today only 6 first-of-each fields).
- **A2. Period rendering.** One ended role → "start – end"; one ongoing role → "start – present"; both
  present and correct in PDF text. → NEW. (Closes the dropped-end-date gap at the render layer; the
  sample's first role is ongoing, so the end-date path is never inspected today.)
- **A3. CJK glyphs.** CJK name + bullet appear in PDF text (not tofu). → KEEP+EXPAND `composer-cjk-renders`.
- **A4. Empty/partial draft.** Blank sections suppress their headings; PDF text has no literal
  "undefined"/"null"; a one-line draft still renders. → NEW at PDF layer (today only THUMB).
- **A5. Geometry + body pagination.** US-Letter dims; a long experience-only draft (no cover) forces
  page 2 — proves the résumé BODY paginates, not just the cover letter. → EXPAND `resume-pdf-render`.
- **A6. Page-label truthfulness.** "N/M" == real page count. → KEEP `resume-pdf-render`.
- **A7. Compact template depth.** Compact renders full content, its distinct layout, and CJK. →
  EXPAND `resume-pdf-render` compact case.
- **A8. Cover-letter page-2 fidelity.** Letter body + salutation + the page-1 QR claim. → EXPAND.

### Group B — preview fidelity + parity (surface: PREVIEW)
- **B1. Preview renders draft content.** SVG carries the draft's name/summary; `data-status=ready`. →
  KEEP `draft-composer-wasm-preview`.
- **B2. Preview CJK not tofu.** CJK in the preview SVG, no missing-glyph. → NEW (preview-side CJK gap).
- **B3. Preview ↔ PDF parity.** Same draft: the sentinels in the preview SVG also appear in the committed
  PDF, and page counts agree. → NEW. (Guards "what you see isn't what you get" — preview and PDF are
  separate renderers/fonts today.)
- **B4. Template switch re-renders (geometry).** classic→compact changes LAYOUT (a geometry/section
  assertion), not a byte-diff. → REWRITE `draft-composer-wasm-preview` byte-diff.

### Group C — QR / URL correctness (surface: PDF + API)
- **C1. Footer/QR host.** The footer URL + QR host == instance `public_url` (https, correct `/handle`,
  `?code=`). → NEW. (Closes the wrong-host gap; a wrong host that still carries `?code=` passes today.)
- **C2. Code picker semantics.** new → fresh code issued in qr_url; existing → reused, none issued;
  none → placeholder. → KEEP `draft-code-picker` + `draft-composer-real-code-qr`, ADD the C1 host check.

### Group D — edit interactions → persisted + in the artifact
- **D1. Canvas in-place edit.** ✎ edit summary → preview recompiles + persists on reopen. → KEEP
  `draft-composer-inplace-edit`.
- **D2. Panel drag-reorder → PDF order.** Reorder rows → the committed PDF renders sections in the new
  order (not just the form). → EXPAND `draft-composer-reorder` (today form-only).
- **D3. Canvas drag-reorder (P3-b).** Drag a section on the canvas → order flips → PDF order. → NEW,
  gated on building P3-b.
  - **Drag MUST be a real Playwright pointer gesture** (owner directive: "typst 一定要真的 pw 拖拽,
    然后看是否拖拽成功"): hover the handle, `page.mouse.down()`, `page.mouse.move(...)` in several
    steps across the target, `page.mouse.up()` — NOT `dispatchEvent`, NOT calling the reorder handler
    directly. Then ASSERT the drag SUCCEEDED by reading the new order in the rendered artifact (preview
    SVG / committed PDF), not just component state. The same rule applies to D2. A drag guard that
    passes without a real gesture moving a real element is a false green — the exact class the owner
    distrusts about `dragTo`.
- **D4. From/to period form.** from+to persist on reopen. → KEEP `draft-composer-period` (its render
  truth lives in A2).
- **D5. Add/remove rows persist.** social/custom/experience/education add+remove round-trip; template
  picks persist. → MERGE `draft-composer-ui` + `draft-composer-backend` (UI + API of the same persist).

### Group E — lifecycle + commit (surface: API, kept thin)
- **E1. Draft-gone → not found.** Parametrized over discard and TTL expiry. → MERGE `resume-draft-discard`
  + `resume-draft-ttl`.
- **E2. Update keeps id + snapshot.** → KEEP `resume-draft-update`.
- **E3. Manual create + preview echo.** → MERGE `drafts-manual-new` + `resume-draft-preview`.
- **E4. SEND consequences.** application row written + PDF rendered with QR + code issued (180d / 10
  sessions / 50 turns) + snapshot frozen + draft cleared. → EXPAND `application-commit-from-composer`
  (today only counts the row).
- **E5. resume_read gating.** exposed on application code, hidden on plain; plus one end-to-end
  `result_bytes>0`. → KEEP `resume-tool-gated-to-applications`; RETIRE the redundant tool-set check in
  `resume-enters-the-conversation`, keep only its log assertion.
- **E6. Drafts list + status pill.** empty state + card + pill color and buttons PER status
  (reviewing/draft/sent). → MERGE `admin-drafts` + `drafts-composer`, ADD the pill semantics the header
  already promises but never checks.

### Group F — visual-designer features (build + guard together)
- **F1. Font color.** owner sets a text color → the color appears in the PDF (Typst `fill`) / preview. → NEW with E.
- **F2. Divider line.** owner inserts a rule → a horizontal line renders between sections in the PDF. → NEW with F.

## 5. Consolidation actions (net effect)

- MERGE: admin-drafts→drafts-composer (E6); discard+ttl→one (E1); manual-new+draft-preview (E3);
  composer-ui+composer-backend (D5).
- RETIRE: the tool-set check in resume-enters-the-conversation (covered by E5).
- REWRITE: resume-pdf-render field checks → A1; wasm-preview byte-diff → B4.
- EXPAND: resume-pdf-render → A2/A5/A7/A8; reorder → D2; application-commit → E4.
- OUT OF SCOPE: `chat-composer`, `visitor-composer-receipt` — the visitor chat input, not the résumé
  composer; leave as is.
- Count: ~24 guards, down from 23 scattered specs, with artifact coverage going from ~1:3 to majority.

## Status (2026-09-06)

Built + GREEN: A1/A2/A3/A4 (composer-pdf-fidelity + composer-cjk-renders), B1 (wasm-preview), B3
(composer-preview-pdf-parity), C1 (resume-qr-host), C2 (draft-code-picker + real-code-qr), D1
(inplace-edit), D2 (reorder→PDF), D3 (canvas-drag, real pointer gesture), D4 (period), E6-partial,
J (empty-heading suppression in A4). Features shipped: D3 canvas drag, D pencil-declutter, E accent
colour, F dividers. Real bugs fixed: period end-date, CJK tofu, custom-not-rendered, footer
watermark, sijie public_url.

Remaining tail (lower priority, documented for a focused follow-up):
- **B2 preview CJK** — needs a self-hosted CJK font asset for the WASM preview (a font-asset pipeline
  like copy-typst-assets); the committed PDF's CJK is already fixed (A3).
- **B4 template-switch geometry** — wasm-preview asserts a byte-diff; upgrade to a layout assertion.
- **E-group consolidations** — merge admin-drafts→drafts-composer, discard+ttl→one, ui+backend, and
  retire the redundant tool-set check in resume-enters-the-conversation. Pure cleanup; deleting
  existing specs, so do it deliberately.
- **ResumePage accent/parity** — the React thumbnail uses a fixed CSS accent; wire it to data.accent.

## 6. Build order

C-fixes first need guards that go RED on the real bug: A2 (period), A3/B2 (CJK), C1 (host). Then the
A1 sweep (the completeness anchor). Then B3 parity, A4/A5 geometry, D2 order. Then D3/F1/F2 as their
features land. Retire/merge as each area's coverage moves.
