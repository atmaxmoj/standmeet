# §R — BYOAI against a real external provider

- **Status:** ⬜ not-run
- **Scope:** runnable-now
- **Prereqs/creds:** reuse the DeepSeek key (`EVAL_KEY` in `eval-harness/.env`) as the **visitor's own** BYOAI key, with the DeepSeek endpoint + model (`https://api.deepseek.com`, `deepseek-v4-pro`) from `verify-creds.env`. Reference the key by name, never print it. No owner-side AI provider is used here — the whole point is the backend calling the *visitor's* third-party provider.
- **Real service:** real DeepSeek `/v1/messages` (or its OpenAI-compat surface) as the visitor-supplied endpoint, replacing the `llm-gateway` scripted mock the BYOAI spec currently pins to.
- **Backing e2e:** (attribution targets) `byoai-chat` · `byoai-errors` · `gate-byoai-ux` · `chat-book-byoai-denied` · `chat-welcome` · `corpus-retrieval-excludes-raw` · `security-byoai-endpoint-ssrf`

> **Why BYOAI's value prop is unverified.** `byoai-chat.spec.ts:64-65` explicitly **overrides the endpoint to the mock** (`http://llm-gateway:9300`) with a comment that a real endpoint "would 401 a fake test key". So the entire BYOAI thesis — the backend taking the visitor's HKDF-encrypted real key, calling the visitor's *real* third-party provider, and enforcing the public-slice ACL on a real model's answer — is never run. Going real means issuing a gate BYOAI session with `EVAL_KEY` against `api.deepseek.com` and asserting both a real streamed answer *and* that the private corpus stays excluded.
>
> One-time setup: on the real stack, from `/gate` open the BYOAI panel → provider/endpoint = DeepSeek, model = `deepseek-v4-pro`, key = `EVAL_KEY` → submit → land on `/<handle>?byoai=1`. Seed the corpus so there's a **private** entry (raw, or an unpublished/non-public wiki/subjectivity note) alongside a **public** one, so R1's exclusion check has something to catch.

## Sub-items

### R1 — Real streamed answer + private corpus stays excluded ⭐
- **Steps:**
  1. Start a BYOAI gate session with the visitor's real DeepSeek key/endpoint (setup above) — no access code, no owner provider.
  2. Ask a question the **public** slice answers → confirm a **real streamed** answer renders (SSE tokens arriving from DeepSeek, owner-voice, grounded), and the welcome states public scope.
  3. Ask a question whose only answer lives in a **private** entry (raw / non-public wiki / subjectivity) → confirm the model is **never handed** that content: no private body in the answer, no private entry in citations, and `corpus_search` returns only the public slice.
- **Expected (likely RED):** (a) a genuine streamed answer from the visitor's real provider — proving the encrypted-key → real-upstream path actually works end-to-end; (b) the private corpus is excluded at retrieval, so the public-slice ACL holds on a real model. The current mock-pinned spec proves neither.
- **⚠️ mock gap:** `byoai-chat.spec.ts:64-65` repoints the endpoint at `llm-gateway:9300`, so it validates the redirect + banner + a *mocked* reply (`MOCK_REPLY`, line 25), never the visitor's real provider. No spec drives a real BYOAI upstream, and no BYOAI-specific spec asserts private-corpus exclusion on a real answer (the exclusion is only ever checked against owner-provider retrieval in `corpus-retrieval-excludes-raw`).
- **Backing test:** `byoai-chat.spec.ts:39` (mock-pinned redirect + reply) · `chat-welcome.spec.ts:46` (BYOAI public-scope welcome) · `chat-book-byoai-denied.spec.ts:18` (BYOAI can't see `calendar.book`) · `corpus-retrieval-excludes-raw.spec.ts:55` (raw exclusion, owner-provider path). Real-upstream BYOAI + private-slice exclusion on a real answer → no backing spec (gap).
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-R-n`)
