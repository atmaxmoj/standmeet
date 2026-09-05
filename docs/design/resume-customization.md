# Resume customization (drafts composer ⇄ Typst)

Status: **backend renderer done; composer is display-only — wiring it up.** (2026-09-05)

## The choice (recall): Typst

The résumé PDF renders through **Typst** (modern LaTeX alternative), not React→PDF. Why: LaTeX-grade
typography, data-driven templates, an owner-customizable presentation over ONE structured content
model, and injection-safety (résumé fields are placed as *content*, never `eval`'d — a field can't
inject Typst code). Templates live in `backend/internal/owner/jobs/resumepdf/templates/*.typ`
(`classic`, `compact`); each renders the same `ResumeContent`, so the choice changes presentation,
never content. The QR is generated server-side (`go-qrcode`) and injected by the renderer — the
owner can't forge it. `typst.ts` (WASM, client-side live preview) was considered and **deferred**;
the authoritative render is the `typst` binary server-side.

## The gap this closes

The renderer is real and reads `resume_drafts.template`. But the **composer never persists** and
the pickers don't exist:

- The composer's `model` is local React state; `SEND` posts `/drafts/{id}/commit` with an **empty
  body**; commit re-renders from the draft ROW (content set at creation via MCP). **Everything the
  owner types in the composer is discarded.** There is no REST write path for draft content/template.
- `social` and `custom` panels render existing rows only — **no add / remove / name** (a fresh
  draft's arrays are empty, so there is nothing to type into: the panel looks broken).
- **No template picker** — `resumepdf.Templates()` exists but has zero callers; the draft views
  don't even serialize `template`.
- **No code picker** — the access code is auto-issued at commit; nothing reads a chosen code, and
  the résumé↔code relationship is invisible. (This is the resolution to the earlier "résumé can't
  enter the conversation / don't couple it" tension: the owner *explicitly picks* the code the QR
  carries — a fresh one, an existing one, or none — no hidden coupling.)
- The right preview is a **client-side `<ResumePage>` mock** with a fake `preview://standmeet/draft`
  QR — not a real Typst render.

## Build plan (each increment ships test-first)

1. **Backend write path.** `PATCH /api/admin/drafts/{id}` (resume_content + template) → a
   `UpdateResumeDraft` usecase + SQL that sets both. `GET /api/admin/drafts/templates` →
   `resumepdf.Templates()`. Draft detail view serializes `template`. Tests: PATCH persists,
   detail reflects it, template list returns classic/compact.
2. **Real Typst preview endpoint.** `GET /api/admin/drafts/{id}/preview.pdf` renders the *actual*
   Typst PDF with a placeholder QR (reuses the renderer). Test: returns `%PDF`, honors the chosen
   template. The composer's right pane shows this real PDF (refreshes on save).
3. **Composer: usable sections + persistence.** `draft-model` gains `template` + blank/add/remove
   for social & custom (custom's label = a self-named section). The composer debounce-saves via
   PATCH, so the "saved" label is real and commit renders what the owner sees. A template picker
   sets `template`. Tests (UI e2e): add a social row / a named custom section → reopen shows it;
   pick a template → preview + commit use it.
4. **Code picker.** Commit accepts a code choice `{code_mode: new|existing|none, code_id?}`:
   `new` issues a fresh code (today's behavior), `existing` reuses an active code, `none` sends the
   résumé with a public-page QR (`/<handle>`, no `?code`) — no grant. The composer surfaces the
   choice and shows which code this résumé is bound to. Tests: each mode → correct code + QR URL.

## Invariants

- **Content is content.** Every résumé field is placed, never evaluated — no Typst injection.
- **The QR is system-owned.** Server-injected; the owner picks *which code* it encodes, never the
  QR bytes.
- **What you see is what you send.** After (3), the preview and the committed PDF render the same
  persisted draft — the composer stops being a facade.
