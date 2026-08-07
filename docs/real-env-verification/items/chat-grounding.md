# chat-grounding — Visitor chat: grounded answer

- **Module:** The visitor's agent answers a substantive question from the owner's corpus. Retrieval fires because the model chose it, the citations match what was actually read, and figures are quoted rather than invented.
- **Surface:** Visitor chat, on the public page or in a coded session.
- **Real dep:** A real model as the owner's provider, and a real corpus with cross-linked notes.
- **Backing e2e:** `visitor-chat-answer-render` · `visitor-chat-cites-writing` · `visitor-chat-cites-output` · `visitor-chat-citation-multi` · `visitor-chat-cited-precise` · `retrieval-search-consistency` · `retrieval-links`. Voice fidelity → `gap`.

## Checks

### 1 — The answer speaks in the owner's voice, from the corpus ⭐
- **Steps:** Ask a substantive question the corpus answers. Read the reply against the notes it drew on.
- **Expected:** First person, in the owner's voice, grounded in real entries. No fabricated fact, no assistant disclaimer, and no generic answer where the corpus holds a specific one.
- **Mock gap:** The mock returns a fixed scripted string, so tone, voice and anti-fabrication are never exercised. No spec asserts owner voice at all.
- **Backing test:** `visitor-chat-answer-render.spec.ts` (render only) · voice → `gap`

### 2 — The model chooses to retrieve ⭐
- **Steps:** Ask something whose answer lives only in the corpus. Watch which tools fire and in what order, without prompting for a search.
- **Expected:** The model calls search, then read, unprompted, and grounds its answer in what came back.
- **Mock gap:** The mock auto-emits search and read whenever they are offered and unresolved, so the decision to retrieve is always the mock's, never the model's.
- **Backing test:** `retrieval-search-consistency.spec.ts` · `visitor-chat-cited-precise.spec.ts`

### 3 — A linked note is reached by following the link
- **Steps:** Ask something answerable only by following a wikilink from one note to another. Watch the tool calls.
- **Expected:** The model uses the links tool and reads the second hop. The answer draws on the linked note, not on a single read.
- **Backing test:** `retrieval-links.spec.ts`

### 4 — The citation footer lists exactly what was read
- **Steps:** Ask a question that requires two distinct entries. Compare the footer against the reads.
- **Expected:** Every cited entry was read, every read entry that shaped the answer is cited, and each reference resolves to a real note.
- **Backing test:** `visitor-chat-citation-multi.spec.ts` · `visitor-chat-cites-output.spec.ts` · `visitor-chat-cites-writing.spec.ts`

### 5 — An exact figure is quoted or declined, never rounded into existence
- **Steps:** Ask for a figure or a date that appears in exactly one entry. Compare the answer against the entry. Then ask for one the corpus does not hold.
- **Expected:** The first is quoted exactly. The second is declined rather than invented.
- **Backing test:** `visitor-chat-cited-precise.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The reply renders as prose, never as raw markup, JSON or a tool dump.
Streaming completes without an error card, and every citation resolves to a real note.
Watch the tool cards on a multi-retrieval turn — a stack of near-empty cards is noise between the visitor and the answer.
