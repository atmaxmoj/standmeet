# chat-ghost — Visitor chat: ghost steering quality

- **Status:** ✅ verified (UPDATE 3, 2026-07-22) — the whole ghost cluster landed + prod-verified: F-A-7 (waypoints editor on /admin/roles — authored `prod-verify-wp` live), F-A-10 (owner ghost-evidence option, role + code override, prod round-trip), F-A-9 (silent turn clears the ghost; e2e test 4 + live: `data-ghost` never stale across 2 sessions). Live model steering quality stays conservative (silence both attempts — rules 2/4) — quality remains a real-model property to observe opportunistically.
- **Module:** the model proposes a well-judged steering "ghost" toward a reachable, unvisited waypoint, and goes silent once all are visited. Quality (relevance, non-repetition, good stopping) is a real-model property.
- **Surface:** visitor chat (multi-turn with waypoints).
- **Real dep:** real DeepSeek. `isGhostPolicy` (`messages.go:89`) fakes the entire GhostPolicy output in the mock.
- **Backing e2e:** `ghost-policy.spec.ts:89` · `visitor-chat-ghost.spec.ts:77` · `ghost-waypoint-freeze.spec.ts`. Real-LLM lane: `eval-harness/ghost-test.sh` (mock-gateway today).

## Checks

### 1 — Ghost steering quality (real-LLM) ⭐  (was §A7)
- **Steps:** run a multi-turn conversation with reachable waypoints → observe the steering ghost the model proposes at each turn; then visit all waypoints and confirm it goes silent.
- **Expected (likely RED):** a *well-judged* ghost toward a reachable, unvisited waypoint that actually redirects the next turns, and **silence** once all are visited. Quality (relevance, non-repetition, good stopping) is a real-model property.
- **⚠️ mock gap:** `isGhostPolicy` (`messages.go:89`) fakes the entire GhostPolicy output; `eval-ghost` runs against the mock gateway *by design* ("no real LLM"). Nothing checks the model's actual judgment.
- **Backing test:** `ghost-policy.spec.ts:89` · `visitor-chat-ghost.spec.ts:77` · `ghost-waypoint-freeze.spec.ts` · `role-waypoints-admin.spec.ts` · `role-ghost-evidence.spec.ts`. Real-LLM lane: `eval-harness/ghost-test.sh` (mock-gateway today).
- **Result:** 🟠 (2026-07-22, real DeepSeek, 2 fresh SUBJ-V01 members) — the *machinery* is fully live (waypoints authorable F-A-7; evidence rule configurable F-A-10; silent-turn clear F-A-9): across both sessions the input never showed a stale ghost (`data-ghost` empty, "ask…"). But the model emitted NO steering ghost in either attempt (on-waypoint opener, then off-topic opener — silence, defensible under rules 2/4), so live steering *quality* (relevance/non-repetition/stopping) remains unobserved — nondeterministic, observe opportunistically in future real sessions. LOOK's "disappears cleanly" half: ✅ live; "renders as designed affordance" half: e2e-only so far.
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The ghost renders as the designed steer affordance (not a raw string); it disappears cleanly once waypoints are exhausted (no lingering empty ghost).

## Findings
(record here; also log `../findings.md`, ID `F-A-n` historical anchor)
