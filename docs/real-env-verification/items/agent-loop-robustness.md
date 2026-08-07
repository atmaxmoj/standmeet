# agent-loop-robustness — Agent loop: real error shapes + parallel + limits

- **Module:** The agent loop survives what only a real provider produces — a mid-turn tool failure, several tool calls in one message, a length-limited stop, and a rate-limit carrying a retry hint — with no crash, no retry storm and no silent quota burn.
- **Surface:** Visitor chat, driven by the backend agent loop.
- **Real dep:** A real provider, or a proxy in front of one that can inject rate-limit responses and retry hints.
- **Backing e2e:** `quota-not-consumed-on-failure` · `conversation-failed-turn-reload` · `connector-retry-exhausted-degrades` · `connector-retry-read-transient-recovers`. Parallel dispatch, length-limited stops, and honouring a retry hint → `gap`.

## Checks

### 1 — A tool failure mid-turn recovers readably
- **Steps:** Cause a real tool to fail during a turn. Read what the visitor sees. Check whether the failed turn consumed quota.
- **Expected:** The model retries or explains, in readable prose. No stack trace reaches the visitor. A failed turn does not consume the visitor's quota.
- **Mock gap:** The mock fails only with a scripted server error on a keyed request. The real error shapes, and the model's own recovery reasoning, are untested.
- **Backing test:** `quota-not-consumed-on-failure.spec.ts` · `conversation-failed-turn-reload.spec.ts`

### 2 — Several tool calls in one message dispatch together
- **Steps:** Ask something that naturally needs two lookups at once. Read how many tool calls the message carried and how the loop dispatched them.
- **Expected:** The loop dispatches them in parallel and folds both results into one answer.
- **Mock gap:** The mock emits exactly one tool call per turn, so the parallel path is never driven.
- **Backing test:** `gap`

### 3 — A length-limited stop finishes readably
- **Steps:** Provoke an answer long enough to hit the output limit. Read what arrives.
- **Expected:** The turn continues or finishes cleanly. It does not hang and it does not stop in the middle of a tool call.
- **Mock gap:** The mock always stops normally, so this stop reason never occurs.
- **Backing test:** `gap`

### 4 — A rate-limited provider backs off instead of hammering
- **Steps:** Put the provider behind something that returns a rate-limit status. Drive calls into it. Watch the retry timing.
- **Expected:** The loop backs off and retries, or degrades to a friendly message. It does not retry tightly.
- **Mock gap:** The mock knows only a scripted server error — no rate-limit status at all.
- **Backing test:** `gap`

### 5 — A retry hint from the provider is obeyed ⭐
- **Steps:** Return a rate-limit response carrying an explicit retry-after delay. Drive a call that trips it. Measure how long the client waits before retrying.
- **Expected:** The client waits at least the delay the provider asked for.
- **Mock gap:** The retry transport retries on a fixed backoff and never reads the header. Against a real rate-limited provider that retries too early and can deepen a ban. No mock ever sends the header, so nothing has ever noticed. The fix must arrive as a test that serves the header and asserts the wait.
- **Backing test:** `connector-retry-*.spec.ts` (retry behaviour, but neither serves the header) · the header itself → `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Every failure mode reaches the transcript as a sentence — no stack trace, no exit code, no error object.
A failed turn leaves no half-rendered bubble and no spinner that never resolves.
A degraded answer says it degraded, because silence about a limit reads as a wrong answer.
