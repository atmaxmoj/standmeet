# agent-loop-robustness — Agent loop: real error shapes + parallel + limits

- **Status:** ⬜ not-run
- **Module:** the agent loop survives what only a real provider produces — a mid-turn tool failure, multiple `tool_use` in one message, a `max_tokens` stop, a `429/529 overloaded` with `Retry-After` — without a crash, a retry storm, or silent quota burn.
- **Surface:** visitor chat (backend agent loop).
- **Real dep:** real DeepSeek (or a fronting proxy to inject 429/`Retry-After`).
- **Backing e2e:** `quota-not-consumed-on-failure` · `conversation-failed-turn-reload`. Parallel dispatch / `max_tokens` / 429+backoff / `Retry-After` → no backing spec (gap).

> The mock only fails via a scripted **500** (`script.go:49`), emits exactly **one** `tool_use` per turn (`messages.go:162`), and always stops `end_turn` (`messages.go:136`) — so the real error shapes, parallel dispatch, `max_tokens`, and rate-limit backoff are all undriven.

## Checks

### 1 — Tool-error recovery  (was §A13)
- **Steps:** induce a real tool failure mid-turn (retrieval/connector error) → observe the model's next move.
- **Expected:** a friendly, user-readable recovery — retries or explains — no raw stack trace, no crash; the failed turn doesn't silently consume quota.
- **⚠️ mock gap:** the mock only fails via a scripted **500** on a keyed request; real error shapes (429/5xx/malformed) and the model's recovery reasoning are untested.
- **Backing test:** `quota-not-consumed-on-failure.spec.ts` · `conversation-failed-turn-reload.spec.ts`
- **Result:** ⬜

### 2 — Parallel tool calls  (was §A14)
- **Steps:** ask something that naturally needs two lookups at once → see whether the real model emits multiple `tool_use` blocks in one message, and whether the agent loop dispatches them in parallel.
- **Expected:** multiple `tool_use` in one assistant message → parallel dispatch → both results folded into the answer.
- **⚠️ mock gap:** the mock emits exactly **one** `tool_use` per turn; the parallel-dispatch path is never driven.
- **Backing test:** no backing spec (gap).
- **Result:** ⬜

### 3 — `max_tokens` truncation + continuation  (was §A15)
- **Steps:** provoke a long answer that hits `max_tokens` → observe graceful finish/continuation.
- **Expected:** a `max_tokens` stop is handled cleanly (continued or finished readably), not a hang or a truncated-mid-tool crash.
- **⚠️ mock gap:** the mock always stops `end_turn`; `max_tokens` never occurs.
- **Backing test:** no backing spec (gap).
- **Result:** ⬜

### 4 — Provider 429/529 overloaded + backoff  (was §A16)
- **Steps:** front the real provider under load (or simulate) so it returns `429`/`529 overloaded` → observe retry/degrade.
- **Expected:** the loop backs off and retries or degrades to a friendly message — not a crash, not a tight retry storm.
- **⚠️ mock gap:** the mock only knows a scripted **500**; no 429/529, no `Retry-After`.
- **Backing test:** no backing spec (gap).
- **Result:** ⬜

### 5 — `Retry-After` honored ⭐  (was §P1)
- **Steps:** front a real integration (or a proxy) that returns `429 Retry-After: 30` → drive a call that trips it → observe the retry timing.
- **Expected:** the client **waits `Retry-After` seconds** before retrying.
- **⚠️ mock gap / likely RED:** `backend/internal/httpx/retry_transport.go:78` (`retriableStatus`) retries `429`/`5xx` on a **fixed backoff** and **never reads `Retry-After`** — on a real rate-limited provider it retries too early and can *worsen* a ban. No mock ever sends `429`/`Retry-After`. The fix must land as a test that reproduces a `Retry-After` response and asserts the wait.
- **Backing test:** `connector-retry-exhausted-degrades.spec.ts` + `connector-retry-read-transient-recovers.spec.ts` (retry behavior — but neither drives a `Retry-After` header; that's the incompleteness).
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Every failure mode surfaces a **friendly** message in the transcript (no stack trace, no exit code); a failed turn doesn't leave a half-rendered bubble or a spinning throbber.

## Findings
(record here; also log `../findings.md`, ID `F-A-n` / `F-P-n` historical anchor)
