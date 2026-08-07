# chat-ghost — Visitor chat: ghost steering quality

- **Module:** The model proposes a steering "ghost" toward a reachable, unvisited waypoint, and goes silent once every waypoint is visited. Relevance, non-repetition and good stopping are real-model properties.
- **Surface:** Visitor chat, multi-turn, on a code whose role carries waypoints. Author the waypoints on `/admin/roles` first.
- **Real dep:** A real model. The mock fakes the entire GhostPolicy output (`isGhostPolicy`, `messages.go`), so the mock can never exercise this.
- **Backing e2e:** `ghost-policy` · `visitor-chat-ghost` · `ghost-waypoint-freeze` · `role-waypoints-admin` · `role-ghost-evidence`. Real-LLM lane: `eval-harness/ghost-test.sh`. Model judgment itself → `gap`.

## Checks

### 1 — The ghost steers toward a reachable, unvisited waypoint ⭐
- **Steps:** Attach two or more waypoints to a role. Enter a session on a code with that role. Take several turns, some on-topic and some off. Read the ghost after each turn.
- **Expected:** The ghost names a waypoint that is reachable and not yet visited. It does not repeat a waypoint already covered. It redirects the turns that follow.
- **Mock gap:** The mock fabricates the whole policy output, so nothing in CI observes the model's judgment.
- **Backing test:** `ghost-policy.spec.ts` (machinery) · model judgment → `gap`

### 2 — The ghost goes silent once every waypoint is visited
- **Steps:** Continue the session until the turns have covered all the waypoints. Read the ghost. Take one more turn. Read it again.
- **Expected:** The ghost is empty and the input shows its ordinary placeholder. No stale ghost from an earlier turn survives.
- **Backing test:** `ghost-waypoint-freeze.spec.ts`

### 3 — A silent turn clears the previous ghost
- **Steps:** Take a turn where the model proposes no ghost. Read the input's ghost attribute. Open a second session and repeat.
- **Expected:** The ghost clears on the silent turn. It never carries over from the previous turn or from another session.
- **Backing test:** `visitor-chat-ghost.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The ghost renders as the designed steer affordance, never as a raw string in the input.
It disappears cleanly when the waypoints run out, leaving no empty ghost behind.
A ghost that survives a reload or a new session is stale state, not a steer.
