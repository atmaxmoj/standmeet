# chat-summarize — Visitor chat: summarize a conversation/report

- **Module:** The model produces a coherent, faithful summary of a real conversation, and the summary renders as a report artifact the visitor can open as a page.
- **Surface:** Visitor chat → the summarize affordance → the report card → `/report/[id]`.
- **Real dep:** A real model. The mock answers summarize with a scripted string matched by turn keys, so it never exercises summary quality.
- **Backing e2e:** `visitor-summarize-conversation.spec.ts`. Summary quality → `gap`.

## Checks

### 1 — A real conversation summarizes faithfully ⭐
- **Steps:** Take several grounded turns so the conversation has content. Ask the agent to summarize. Wait for the card. Read the summary against what was actually said.
- **Expected:** The card renders with its title, lede and topics, and every claim in it traces to something said in the conversation. It is not an empty or placeholder card.
- **Mock gap:** Summarize is a backend-initiated generate call that the mock answers with a scripted string. Quality has no coverage.
- **Backing test:** `visitor-summarize-conversation.spec.ts`

### 2 — The report opens as its own page
- **Steps:** Click "open as page" on the card. Read `/report/[id]`. Page through it.
- **Expected:** The page renders the same summary and paginates.
- **Backing test:** `visitor-summarize-conversation.spec.ts`

### 3 — The conversation continues after a summary
- **Steps:** Ask another question after the summary. Read the reply and the turn counter. Reload the page.
- **Expected:** The reply renders, the turn count rises, and both the summary and the new turn survive the reload.
- **Backing test:** `visitor-summarize-conversation.spec.ts`

### 4 — A restored transcript still contains the summarize exchange
- **Steps:** Summarize. Leave the session. Restore it. Read the transcript from the top.
- **Expected:** The summarize exchange appears in the restored transcript, in the place it happened.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The report card carries real content, never an empty frame with a title.
`/report/[id]` opens and paginates.
Anything that happened in the session is still in the transcript after a restore.
