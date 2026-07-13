# §Q — Product closed-loop journeys

- **Status:** ⬜ not-run
- **Scope:** `Q3 runnable-now` · `Q2 mail-runnable (pairs §C)` · `Q1 phone-last`
- **Prereqs/creds:** Q3 needs the real prod stack + a real MCP client (§M) + a real LLM key (`[LLM]`, §A). Q2 needs a real mail path (`[MAIL]`, §C). Q1 needs the real gotenberg PDF (§I2) + a real LLM answer + `[PHONE]` (a physical phone camera) for its last layer.
- **Real service:** the **whole loop end-to-end** with real actors — real PDF+QR, real phone scan, real /gate skip, real-LLM owner-voice answer (Q1); real access-request → approve → email-with-code → redeem (Q2, real mail); real MCP ingest → next real-LLM turn grounds on it (Q3). CI proves the *segments*; none of these walks the *loop*.
- **Backing e2e:** (attribution targets) `integration-job-loop` · `applications-commit-qr-works` · `qr-code-absorb` · `admin-requests` · `mail-connector` · `booking-confirmation-email` · `mcp-show-grounding` · `retrieval-search-consistency` · `owner-mcp-parity-mutations` · `integration-corpus-pipeline`

## Sub-items

### Q1 — Recruiter physical closed loop  (phone-last)
The outbound thesis walked with real actors. Three layers, verifiable independently, hardest last:

- **Layer 1 — QR decodes to the correct URL (programmatic, runnable now).**
  - **Steps:** render the real `applications.commit` PDF via real gotenberg (§I2) → extract the QR image → decode it programmatically (e.g. `zbarimg`) → assert the decoded string is exactly `/{handle}?code=<CODE>` for the issued code.
  - **Expected:** the QR encodes the correct handle + issued access code; the URL, hit directly, skips `/gate` and opens a visitor session.
  - **Backing test:** `applications-commit-qr-works.spec.ts:34` (issued code opens a session via POST /api/v1/sessions) · `qr-code-absorb.spec.ts:31` (lands on `/?code=…` → URL stripped + picker) · `applications-commit.spec.ts:43` (QR points at owner)

- **Layer 2 — a real scanner app decodes the printed QR (Android emulator).**
  - **Steps:** display/print the PDF, point an Android-emulator camera + a real QR-scanner app at it → confirm it opens the URL.
  - **Expected:** a real scanner app (not just a library) resolves the code — proves contrast/size/quiet-zone are scan-viable.
  - **Backing test:** none (gap — no emulator harness); `manual-only` via emulator.

- **Layer 3 — real print → photo with a physical phone (`manual-only`, do LAST).**
  - **Steps:** physically print the PDF → scan the top-right QR with a **real phone camera** → land in the ChatRoom → ask a question → get a **real-LLM owner-voice answer**.
  - **Expected:** the full physical loop closes: paper → phone → /{handle}?code= → skip /gate → owner-voice answer.
  - **⚠️ mock gap:** today the "scan" is `page.goto('/?code=…')` and the answer is **scripted** (inventory §Q1, `[scan]`) — the real optics + real-LLM answer are never walked. `manual-only`: real-phone optics can't be reproduced in CI (sop.md iron rule 3). Do this layer **last**.
  - **Backing test:** `integration-job-loop.spec.ts:45` (recruiter scans QR → lands in ChatRoom — but `page.goto`, scripted answer) · `integration-job-loop.spec.ts:65` (recruiter session carries application context)
- **Result:** ⬜

### Q2 — Access-request → approve → email-with-code → redeem  (pairs §C)
- **Steps:** a no-code visitor submits a request on `/gate` → owner sees it in admin → approves → a real code email lands in a **real inbox** (§C) → the visitor opens the emailed `/{handle}?code=` → session opens → chat works. One continuous journey, not segments.
- **Expected:** the whole chain works with **real mail**; approve is blocked without a verified mail connector; the emailed code redeems into a working session.
- **⚠️ mock gap:** no single spec walks the whole thing (inventory §Q2) — CI proves the request list, the approve gate, and code redemption **separately**; the real-mail hop in the middle is only ever mailpit/mock. Pair with §C.
- **Backing test:** `admin-requests.spec.ts:35` (seeded request appears) · `admin-requests.spec.ts:70` (approve rejected without verified mail connector) · `mail-connector.spec.ts:29` (approve → code emailed → code opens a session) · `access-codes.spec.ts` (redemption)
- **Result:** ⬜

### Q3 — Ingest → answer feedback loop
- **Steps:** owner adds a corpus note via **real MCP** (§M: `raw_dump` → `promote_to_wiki` / `subjectivity_write` through a real client) → then a **next real-LLM visitor turn** asks about it → confirm the answer **grounds on the just-added note** (cites/uses it), not on stale corpus.
- **Expected:** the freshly ingested note is immediately retrievable and the real model grounds the next turn on it — the ingest→answer loop closes live.
- **⚠️ mock gap:** CI proves ingest (owner-mcp mutations) and grounding (`mcp-show-grounding`) **separately**, both against the scripted LLM; the loop — real MCP write, then a *real model* retrieving and grounding on it in the very next turn — is never walked. Pairs with §A (real LLM) + §M (real MCP client).
- **Backing test:** `retrieval-search-consistency.spec.ts:108` (promote → immediately searchable) · `mcp-show-grounding.spec.ts:51` (show_grounding returns assistant message + cited title) · `owner-mcp-parity-mutations.spec.ts` (real MCP mutation roundtrips) · `integration-corpus-pipeline.spec.ts:45` (dumped raw → wiki → landing)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-Q-n`)
