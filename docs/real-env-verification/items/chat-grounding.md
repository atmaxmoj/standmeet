# chat-grounding — Visitor chat: grounded answer

- **Status:** ⬜ not-run
- **Module:** the coded/visitor agent answers a substantive question grounded in the owner's corpus — retrieval fires by the model's own choice, citations match what was read, numbers are honest.
- **Surface:** visitor chat (index / coded session).
- **Real dep:** real DeepSeek (`EVAL_KEY`, `deepseek-v4-pro`) as the owner AI provider + a small real corpus (raw→wiki, cross-linked notes). Reference the key by name.
- **Inherits (historical finding IDs):** `F-A-1` (sandbox tools bind — ✅ fixed), `F-A-2` (thesis-violating corpus-search box removed — ✅ fixed).
- **Backing e2e:** `visitor-chat-answer-render` · `visitor-chat-cites-writing` · `visitor-chat-cites-output` · `visitor-chat-citation-multi` · `visitor-chat-cited-precise` · `retrieval-search-consistency` · `retrieval-links`

> The mock never runs the model's reasoning: `mock-llm-script.ts` pops a queued `{tool,args}` per turn, auto-emits `corpus_search`/`corpus_read` when offered-and-unresolved (`messages.go:5-8`), and returns a fixed scripted string (`emitFinalReply`, `messages.go:198`). So the *decision to retrieve* and the *voice/grounding* are the mock's, not the model's. This module swaps that for a real model.

## Checks

### 1 — Grounded answer in owner voice  (was §A1)
- **Steps:** coded visitor asks a substantive question the corpus answers → observe the reply.
- **Expected:** first-person, in the owner's voice, grounded in the seeded corpus; no fabricated facts, no "as an AI" disclaimer, no generic answer where the corpus has a specific one.
- **⚠️ mock gap:** the mock returns a fixed scripted string; tone/voice/anti-fabrication are never exercised. No spec asserts *owner voice* at all.
- **Backing test:** `visitor-chat-answer-render.spec.ts:71` (render only) · `visitor-chat-cites-writing.spec.ts:59` (grounding). Voice fidelity → no backing spec (gap).
- **Result:** ⬜

### 2 — Retrieval actually fires (model *chooses* to search)  (was §A2)
- **Steps:** ask a question whose answer lives only in the corpus → confirm the model itself calls `corpus_search` then `corpus_read` (not scripted).
- **Expected:** unprompted `corpus_search` → `corpus_read` → grounded answer.
- **⚠️ mock gap:** the mock auto-emits `corpus_search`/`corpus_read` whenever offered-and-unresolved (`messages.go:5-8`), so the *decision to retrieve* is the mock's, never the model's.
- **Backing test:** `retrieval-search-consistency.spec.ts:108` · `visitor-chat-cited-precise.spec.ts:53`
- **Result:** ⬜

### 3 — `corpus_links` multi-hop  (was §A3)
- **Steps:** ask something that requires following a wikilink from one note to a linked note → confirm the model uses `corpus_links` and reads the second hop.
- **Expected:** the answer draws on the linked note, reached via `corpus_links`, not a single read.
- **Backing test:** `retrieval-links.spec.ts:113`
- **Result:** ⬜

### 4 — Citation footer matches reads  (was §A4)
- **Steps:** ask a question that reads two distinct entries → inspect the citation footer.
- **Expected:** the footer lists exactly the entries actually read (title + resolvable ref), no phantom or missing citations.
- **Backing test:** `visitor-chat-citation-multi.spec.ts:51` · `visitor-chat-cites-output.spec.ts:55` · `visitor-chat-cites-writing.spec.ts:59`
- **Result:** ⬜

### 5 — Precise-number honesty  (was §A11)
- **Steps:** ask a question whose exact answer (a figure, a date) is in one corpus entry → check the number.
- **Expected:** the model quotes the corpus figure exactly and doesn't round/invent; if the corpus lacks it, it declines rather than fabricates.
- **Backing test:** `visitor-chat-cited-precise.spec.ts:53`
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity for this module's surface (SOP §1b)
Task-free, while driving visitor chat: the **reply renders as prose** (not raw markdown / JSON / a tool dump), streaming completes with no error card, and **citations resolve to real notes** (not dead links). The stacked near-empty tool cards on a multi-retrieval turn are a known throbber gripe (UX-10).

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-A-n` kept as the historical anchor)

### Second pass (2026-07-14, real DeepSeek on prod, coded visitor VERIFY-A01)
- **Check 1 voice ✅** — clean first-person, no "as an AI" disclaimer, natural owner tone.
- **Check 2 retrieval-by-choice ✅** — on an open question the model chose **12** `corpus_search`/`corpus_read` calls unprompted (mock only ever emits 1/turn). Retrieval decision is genuinely the model's.
- **Check 5 anti-fabrication ✅** — explicitly refused to invent a contrarian take ("rather than a fake one").
- Still to drive: check 3 (multi-hop links), check 4 (citation-footer accuracy).
