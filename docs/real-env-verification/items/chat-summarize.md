# chat-summarize — Visitor chat: summarize a conversation/report

- **Status:** ⬜ not-run
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
- **Result:** 🔴 manual-red (F-A-6)

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The report artifact renders the summary (not an empty/placeholder card); the `/report/[id]` view opens and paginates.

## Findings
(record here; also log `../findings.md`, ID `F-A-n` historical anchor)
