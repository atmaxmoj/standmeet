# chat-byoai — Visitor chat: BYOAI against a real provider

- **Status:** ⬜ not-run
- **Module:** a no-code gate visitor brings their own AI key; the backend HKDF-encrypts it, calls the visitor's *real* third-party provider, streams a real answer, and the public-slice ACL still excludes private corpus on that real model.
- **Surface:** gate BYOAI panel → visitor chat (`/<handle>?byoai=1`).
- **Real dep:** the DeepSeek key (`EVAL_KEY`) as the **visitor's own** BYOAI key (`https://api.deepseek.com`, `deepseek-v4-pro`). No owner-side AI provider. Seed a **private** entry alongside a **public** one so the exclusion check has something to catch.
- **Backing e2e:** `byoai-chat` · `byoai-errors` · `gate-byoai-ux` · `chat-book-byoai-denied` · `chat-welcome` · `corpus-retrieval-excludes-raw` · `security-byoai-endpoint-ssrf`.

> **Why BYOAI's value prop is unverified.** `byoai-chat.spec.ts:64-65` explicitly **overrides the endpoint to the mock** (`http://llm-gateway:9300`) with a comment that a real endpoint "would 401 a fake test key". So the entire BYOAI thesis — backend taking the visitor's encrypted real key, calling the visitor's *real* provider, and enforcing the public-slice ACL on a real model's answer — is never run.

## Checks

### 1 — Real streamed answer + private corpus stays excluded ⭐  (was §R1)
- **Steps:**
  1. Start a BYOAI gate session with the visitor's real DeepSeek key/endpoint — no access code, no owner provider.
  2. Ask a question the **public** slice answers → confirm a **real streamed** answer renders (SSE tokens from DeepSeek, owner-voice, grounded), welcome states public scope.
  3. Ask a question whose only answer lives in a **private** entry (raw / non-public wiki / subjectivity) → confirm the model is **never handed** that content: no private body in the answer, no private entry in citations, `corpus_search` returns only the public slice.
- **Expected (likely RED):** (a) a genuine streamed answer from the visitor's real provider — proving the encrypted-key → real-upstream path works end-to-end; (b) the private corpus is excluded at retrieval, so the public-slice ACL holds on a real model. The mock-pinned spec proves neither.
- **⚠️ mock gap:** `byoai-chat.spec.ts:64-65` repoints the endpoint at `llm-gateway:9300`, validating a *mocked* reply; no spec drives a real BYOAI upstream, and no BYOAI-specific spec asserts private-corpus exclusion on a real answer.
- **Backing test:** `byoai-chat.spec.ts:39` (mock-pinned) · `chat-welcome.spec.ts:46` (BYOAI public-scope welcome) · `chat-book-byoai-denied.spec.ts:18` · `corpus-retrieval-excludes-raw.spec.ts:55` (owner-provider path). Real-upstream BYOAI + private-slice exclusion on a real answer → no backing spec (gap).
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The gate **BYOAI panel renders and accepts a key**; on submit it lands on `/<handle>?byoai=1`; the welcome states public scope; a real streamed answer renders token-by-token, not a stalled empty bubble.

## Findings
(record here; also log `../findings.md`, ID `F-R-n` historical anchor)

- **Envelope + stream PASS (2026-07-13, real, 2nd pass):** created a byoai session, replicated the client envelope (HKDF-SHA256(session_token,"standmeet-byoai-v1") → AES-256-GCM), POSTed `/agent/turn` with `X-Byoai-{Provider,Key,Endpoint,Model}`. Backend decrypted the visitor's **real DeepSeek key** server-side and **streamed a real answer**. Envelope + provider routing + streaming all work; grounding/public-corpus-ACL was blocked by F-A-1 at the time (same sandbox root, since fixed) — re-run the exclusion leg now.
