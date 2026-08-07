# chat-byoai — Visitor chat: BYOAI against a real provider

- **Module:** A visitor with no code brings their own AI key. The backend encrypts it, calls the visitor's real third-party provider, and streams a real answer. The public-slice ACL still holds on that real model.
- **Surface:** The gate's BYOAI panel → visitor chat at `/<handle>?byoai=1`.
- **Real dep:** A real third-party key and endpoint used as the VISITOR's own. No owner-side provider. Seed one private entry beside a public one, so the exclusion check has something to catch.
- **Backing e2e:** `byoai-chat` · `byoai-errors` · `gate-byoai-ux` · `chat-book-byoai-denied` · `chat-welcome` · `corpus-retrieval-excludes-raw` · `security-byoai-endpoint-ssrf`. A real upstream and private-slice exclusion on a real answer → `gap`.

## Checks

### 1 — The visitor's real provider answers, streamed ⭐
- **Steps:** Open the gate with no access code. Enter a real key, endpoint and model in the BYOAI panel. Submit. Ask a question the public slice can answer. Watch the reply arrive.
- **Expected:** The answer streams token by token from the visitor's own provider, not from a stall or an empty bubble. It reads in the owner's voice and cites public entries. This proves the encrypted-key path reaches a real upstream.
- **Mock gap:** `byoai-chat.spec.ts` repoints the endpoint at the mock gateway, with a comment that a real endpoint would reject a fake test key. So the whole BYOAI thesis — visitor's encrypted real key, visitor's real provider, ACL enforced on a real model's answer — is never run in CI.
- **Backing test:** `byoai-chat.spec.ts` (mock-pinned) · real upstream → `gap`

### 2 — The private slice is never handed to the visitor's model ⭐
- **Steps:** In the same BYOAI session, ask a question whose only answer lives in a private entry — a raw note, an unpublished wiki entry, or subjectivity. Read the answer, the citations, and what `corpus_search` returned.
- **Expected:** The answer contains no private body text and no fabricated stand-in for it. No private entry appears in the citations. Retrieval returned only the public slice.
- **Backing test:** `corpus-retrieval-excludes-raw.spec.ts` (owner-provider path) · BYOAI path → `gap`

### 3 — The welcome states the scope the visitor actually has
- **Steps:** Read the welcome line on entering a BYOAI session.
- **Expected:** It says the visitor is on the public slice. It does not imply an invited scope.
- **Backing test:** `chat-welcome.spec.ts`

### 4 — A capability the visitor was not granted stays denied
- **Steps:** In the BYOAI session, ask for a booking.
- **Expected:** The request is denied, and no booking is created.
- **Backing test:** `chat-book-byoai-denied.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The BYOAI panel renders, accepts a key, and lands the visitor on the chat.
The first answer streams token by token — a stalled empty bubble is a failure even if text arrives eventually.
The welcome names the scope, so the visitor knows what this session can and cannot see.
