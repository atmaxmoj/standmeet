# chat-summarize — Visitor chat: summarize a conversation/report

- **Status:** ✅ verified (UPDATE 3, 2026-07-22) — F-A-6 CLOSED live (root: 15s CallTool cap → `long_running`/120s): real-DeepSeek summarize rendered a FULL report card ("Subjectivity as a Lossy Signal", screenshot in F-A-6 row); the next ask rendered, counted (2/20), persisted. NEW: F-A-19 — the summarize dialog is absent from the RESTORED transcript (recorded, next cycle).
- **Module:** the model produces a coherent, faithful summary of a real conversation or report, and it renders in the report artifact / `/report/[id]`.
- **Surface:** visitor chat → report artifact (`/report/[id]`).
- **Real dep:** real DeepSeek.
- **Backing e2e:** `visitor-summarize-conversation.spec.ts:71`

## Checks

### 1 — Summarize a real conversation/report  (was §A8)
- **Steps:** ask the agent to summarize the conversation (or a report) → real model produces the summary → it renders in the report artifact / `/report/[id]`.
- **Expected:** a coherent, faithful summary of what was actually said; PDF/report renders.
- **⚠️ mock gap:** summarize is a backend-initiated generate call the mock matches by turn keys (`messages.go:97,160`) and answers with a scripted string; summary quality is never tested.
- **Backing test:** `visitor-summarize-conversation.spec.ts:71`
- **Result:** ✅ (2026-07-22, real DeepSeek, SUBJ-V01/LiveVerify) — after a grounded turn (searched 8 · read 18), summarize rendered the full report card (title+lede+chips+quote+Key Topics; "open as page ↗" present); faithful to what was said. Post-summarize ask worked + persisted. Sub-finding F-A-19 (dialog absent after RESTORE) recorded separately.
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The report artifact renders the summary (not an empty/placeholder card); the `/report/[id]` view opens and paginates.

## Findings
(record here; also log `../findings.md`, ID `F-A-n` historical anchor)
