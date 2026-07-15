# chat-ghost — Visitor chat: ghost steering quality

- **Status:** ⬜ not-run
- **Module:** the model proposes a well-judged steering "ghost" toward a reachable, unvisited waypoint, and goes silent once all are visited. Quality (relevance, non-repetition, good stopping) is a real-model property.
- **Surface:** visitor chat (multi-turn with waypoints).
- **Real dep:** real DeepSeek. `isGhostPolicy` (`messages.go:89`) fakes the entire GhostPolicy output in the mock.
- **Backing e2e:** `ghost-policy.spec.ts:89` · `visitor-chat-ghost.spec.ts:77` · `ghost-waypoint-freeze.spec.ts`. Real-LLM lane: `eval-harness/ghost-test.sh` (mock-gateway today).

## Checks

### 1 — Ghost steering quality (real-LLM) ⭐  (was §A7)
- **Steps:** run a multi-turn conversation with reachable waypoints → observe the steering ghost the model proposes at each turn; then visit all waypoints and confirm it goes silent.
- **Expected (likely RED):** a *well-judged* ghost toward a reachable, unvisited waypoint that actually redirects the next turns, and **silence** once all are visited. Quality (relevance, non-repetition, good stopping) is a real-model property.
- **⚠️ mock gap:** `isGhostPolicy` (`messages.go:89`) fakes the entire GhostPolicy output; `eval-ghost` runs against the mock gateway *by design* ("no real LLM"). Nothing checks the model's actual judgment.
- **Backing test:** `ghost-policy.spec.ts:89` · `visitor-chat-ghost.spec.ts:77` · `ghost-waypoint-freeze.spec.ts`. Real-LLM lane: `eval-harness/ghost-test.sh` (mock-gateway today).
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The ghost renders as the designed steer affordance (not a raw string); it disappears cleanly once waypoints are exhausted (no lingering empty ghost).

## Findings
(record here; also log `../findings.md`, ID `F-A-n` historical anchor)
