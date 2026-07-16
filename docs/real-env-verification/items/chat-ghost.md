# chat-ghost — Visitor chat: ghost steering quality

- **Status:** ✅ check 1 GREEN (2026-07-15, real DeepSeek) — steering quality AND silence both verified end-to-end on the real GUI. Two findings fell out: **F-A-7** (waypoints have no admin GUI — the reason this was undriveable all audit; seeded via the real API for setup) and **F-A-9** (a stale ghost lingers client-side once the policy goes silent).
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
- **Result:** ✅ **GREEN (2026-07-15, real DeepSeek).** Setup (the ⭐ route has no deterministic backing, so this is the only way it gets verified): authored waypoints on `subj-verify` via the real API (**no GUI exists — F-A-7**), then issued a code **after** that (`GHOST-WP1` / `GHOST-SIL1`) — the role is **frozen at code issue**, which is why three earlier runs on the pre-waypoint `SUBJ-V01` showed no ghost at all. That was the design working, not a bug.<br>**Steering quality — genuinely well-judged, not a lurch.** Asked something far from both waypoints ("what languages do you use day to day?"); the ghost used a thread the answer actually raised as its bridge: *"You mentioned StandMeet a couple of times now — what was the motivation for building it?"* (→ the `dont-repeat-myself` waypoint). Next: *"Got it — so StandMeet literally lets you stop repeating yourself. Could we talk about how that might work for my situation?"* Then, toward the other waypoint, quoting the owner's own words back: *"You said the way out is structural, not persuasion. When you've set up an arbitration seat in the past, what did that actually look like? Did you just designate a senior person, or was it more formal?"* Three ghosts, all distinct, each grounded in the prior answer — non-repetition holds.<br>**Silence — confirmed.** With one waypoint carrying real `evidence_refs`, the turn that cited that note (verified in the persisted turn: `dont-repeat-myself` among its 8 citations) marked it visited, and the next turn emitted **no ghost** (`placeholder: "ask…"` after a reload). The contrast is what proves it: with NO `evidence_refs` (never markable) the ghost changed every turn; with them, it stopped. **Residual: F-A-9** — the client keeps rendering the last ghost when a turn returns none, so silence is invisible until a reload.

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The ghost renders as the designed steer affordance (not a raw string); it disappears cleanly once waypoints are exhausted (no lingering empty ghost).

## Findings
(record here; also log `../findings.md`, ID `F-A-n` historical anchor)
