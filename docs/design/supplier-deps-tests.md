# Connector dependency resolution refactor — test design (checklist + state/error matrices)

> **Status:** Plan (2026-06-24). The **test checklist** for this refactor: what to add, which existing tests to rework, and which
> acceptance tests run alongside. Scope is limited to this connector-dependency-resolution cut, plus the
> leftovers that have been "waiting to change together with connectors" (externalize the booked card + move cancel/email from REST to connector-backed tools). **Leave no legacy behind when done.**
> Scheduling (TDD phases) is separate; this document only decides **what to test**.

## Scope

**What this cut does**

1. **Host dependency resolution layer** — named dep provider registry + read `manifest.Requires` + resolve:
   - **Gate half → merged into the global gate**: if any connector in `Requires` is not connected → the cap does not enter
     `enabledCaps` (the registry's single gate, the only entry point for every visitor walk) → hidden from every session.
     Delete the hard-coded `Connected()` self-checks inside caps such as booker.
   - **Inject half**: when connected, inject the connector **handle (not credentials)** into the running binding/plugin.
2. **Leftovers** — add `mcp-ui:tool` to the host protocol; booker `Requires:[calendar,smtp]` gets both handles injected;
   book/cancel/send_confirmation become connector-backed tools; the booked ui:// card calls through `mcp-ui:tool`;
   retire the REST endpoints and the last hard-coded React card (`NON_SANDBOX_CARDS` becomes empty).

**Out of this scope:** sync mode (Obsidian→corpus, #107/#108 is its own track); surfaces unrelated to connectors.

## Locked decisions

- **D-1: Not connected = fully hidden (through global), not degraded-but-visible.** Keep current behavior; the greyed-out button UX belongs to #110.
- **D-2: Connector gating goes into `enabledCaps` (the global single gate)**; do not add a separate per-session gate.
  `global(cap) = owner did not switch it off ∧ every Requires is connected`.
- **D-3: Externalizing booked + cancel/email→tool are in this cut**, done cleanly.
- **D-4: The recipient hard controls for the confirmation email (quote/pass-through/422/skip) live inside the tool (backend validation; the 422 still comes from the backend).**
  The card only collects + displays — #121 recipient hard control is guarded by the `send_confirmation` tool on the backend, and the sandboxed card cannot bypass it.
- **D-8: Connector = a consumer-agnostic, bidirectional substrate.** Credentials/OAuth/retries all live inside the connector; **whoever uses it does not know about them**.
  MCP capabilities (gated through capreg dependency resolution) are only "one of the consumers"; the future **IM Gateway** (owner is
  @-mentioned in Discord/Slack → Gateway wakes an agent → the agent uses connector credentials to **read channel history** + **send messages**)
  is another consumer and **does not touch MCP**. So "resolve a connector by name + get a handle" must live in a neutral place and **must not import
  capreg**; handles are bidirectional (read+write) with no credential getter. Guard test: `connector.TestConnector_
  ConsumerAgnostic_BidirectionalGateway` (fakeGateway does not import capreg = compile-time proof).
  In the implementation phase, merge `capreg.DepRegistry` into the neutral `connector.Hub` (one substrate, many consumers).

## Test philosophy (carried over from the platform architecture test design)

- Plugins / connectors are real external dependencies → **mock at the transport boundary, do not stub**. Synthetic connectors plug into the real registry;
  test MCP plugins use a real server (`mock-stack/mcp`).
- **Check against the feature floor item by item**: global/role/code ACL, **connector dependencies**, quota, mode,
  capability_state, degraded-but-visible.
- **Error stream**: any step of the chain can crash and stay controlled, degrading gracefully, with no stack/hang/secret leak.
- **Stand-ins**: `dep-provider:test` (synthetic connector "X": `Connected` is toggleable + proxied method calls + a leak probe;
  wired only in tests, never in the prod registry); `mock-stack/mcp` adds a tool with `Requires:["dep-provider:test"]`;
  mock GCal / SMTP / OAuth reuse external-mock.

---

## 1. Tests to add (new, do not exist today)

**Backend unit / integration**
- dep-provider registry: register / lookup / reject duplicate names
- `Requires` boot validation: unknown dependency name → reject + log (today `manifest_test` only tests parsing)
- `enabledCaps` folds in connector state: an unconnected entry in `Requires` → not in enabledCaps
- Handle contract: returns a handle when connected, **no credential getter** (compile-time guarantee that secrets never reach the caller)
- Multi-dependency AND (A connected, B not → still hidden); the global manual switch-off takes priority over "connected"
- Handling when `provider.Connected()` returns an error (not true/false) (see error matrix E1)

**e2e**
- **Arbitrariness (the crux)**: synthetic X + `mock-stack/mcp` `Requires:[X]` → dropped when not connected / works when connected / no secret leak / revoked mid-session → degrades
- **ext-mcp does not get deps by default** (even when it declares `Requires:[calendar]` nothing is injected; it needs explicit owner authorization)
- **The single gate is consistent across the three walks** (AssembleVisitor / VisitorStates / VisitorToolSpecs include and exclude together)
- **`mcp-ui:tool` protocol**: the card sends a named tool → host dispatches with session context → returns to the card (unit + card integration)
- **visitor `calendar_cancel` as a tool** (today it is REST only) + **`send_confirmation` as a tool** (today REST)
- **No secret leaks into the booker plugin** (the new leak surface after handle injection)
- Every gap in state changes + error stream (see the two matrices below; each cell marked "add" = one test case)

## 2. Tests to rework (existing, because the mechanism/structure changes)

- `visitor-cancel-booking` — cancel moves from "React card + REST" → iframe card + `mcp-ui:tool→calendar_cancel`;
  testids + mechanism all change (**keep the isolation negative case**: Mallory cannot cancel Dana's booking)
- `booking-confirmation-email` — sending moves from "`booking-email-*` + REST" → iframe card +
  `mcp-ui:tool→send_confirmation`; the four cases quote/pass-through/422/skip are re-expressed inside the card (recipient validation per D-4)
- `visitor-chat-book-card` — React booked card → `mcp-app-card-calendar_book` iframe (frameLocator)
- `manifest_test.go` — add `Requires` rejection cases
- `supplier-secret-no-leak` — extend: also assert that secrets do not reach the booker plugin
- capreg / ACL hierarchy unit tests — enabledCaps now computes connector state; add cases

## 3. State-change matrix (connector lifecycle × timing) — focus on missing nothing

Lifecycle: `not configured → credentials configured but not authorized (no refresh_token) → connected → disconnected (token cleared, credentials kept) → reconnected → externally revoked (invalid_grant)`.
Timing: ① at assembly ② between two turns (state changes between turns) ③ mid-call within the same turn ④ mid-stream (during SSE).

| State / transition | Timing | Expected | Coverage |
|---|---|---|---|
| Not configured | Assembly | Hidden | ✓ `chat-book-not-connected` (implicit) |
| **Credentials configured, not authorized (no refresh_token)** | Assembly | `Connected=false` → hidden | **add** (half-config boundary) |
| Connected | Assembly | Exposed + handle injected | ✓ `chat-book-success` |
| Connected | Mid-call | Works | ✓ |
| **Connected→disconnected (owner disconnect)** | Between turns | Next turn the tool is hidden (single gate recomputed) | **add** (mid-session disconnect) |
| **Connected→disconnected** | Mid-call (tool list already sent, disconnected at call time) | Graceful degradation, no 500/stack | **add** (dependency drops mid-turn) |
| **Disconnected→reconnected** | Between turns | Tool reappears next turn | **add** |
| **Disconnected (token cleared, credentials kept)** | Assembly | Hidden (`refresh_token IS NULL`) | Partial ✓ `admin-gcal-disconnect` (fresh session) |
| Token expired, refreshable | Mid-call | Silent refresh succeeds | ✓ `chat-book-token-refresh` |
| **Token revoked (invalid_grant)** | Mid-call | Refresh hits invalid_grant → graceful degradation | ✓ `connector-revoked-degrades` |
| **State persisted after revocation** | Next assembly after revocation | Set disconnected → hidden (revocation→gate linkage) | **add** |
| Mail disconnected | Between turns | Capabilities that depend on smtp are hidden | Partial ✓ `mail-connector` (fresh) → **add** mid-session |
| **Concurrent sessions** | Owner disconnects | Both sessions lose the tool on their next turn | **add** |
| **Identity field change: mail switches SMTP address/host/password** | edit-config | `verified=false` → capabilities depending on smtp hidden → restored only after OTP again | **add** |
| **Identity field change: calendar switches client_id/secret** | edit-config | Clear token (`refresh_token=NULL`) → hidden → restored only after OAuth again | **add** |
| **Non-identity field change (policy / calendar_id / display name)** | edit-config | Does **not** disconnect; connection/verification state unchanged | **add** (guards "only an identity change forces re-verification") |

> Today we basically test only two points: "state at assembly" and "mid-call refresh failure"; **state flips between turns, drops mid-turn,
> revocation→gate linkage, half-config, concurrency, config change→re-verification** are all missing.
>
> **Decision D-5: changing a connector "identity" field (credentials/address/host) → reset verified/token, force re-verification,
> hidden meanwhile; changing a "non-identity" field (policy/calendar_id/display name) leaves the connection alone.**

## 4. Error-stream matrix (failure at every step of the chain) — leave nothing out

Chain: `assembly resolution → provider.Connected? → inject handle → plugin tool call → connector proxy → decrypt → external (Google/SMTP) → return`.

| # | Step | Failure mode | Expected | Coverage |
|---|---|---|---|---|
| E1 | `provider.Connected()` | DB read error | Treat as not connected, hide + log, do not crash | **add** |
| E2 | Resolution | Unknown dependency name at runtime (defensive; in theory impossible after boot) | Hide + log | **add** |
| E3 | Injection | Handle construction fails | Capability hidden / friendly | **add** |
| E4 | proxy | Plugin→host unix socket unreachable | Graceful degradation | Partial (generic plugin-down test) → **add** connector-specific |
| E5 | Decrypt | Vault corrupted / key mismatch | Friendly, **no secret in the error** | **add** |
| E6 | Google | `freeBusy`/`events.insert` returns 500 / 403 / 429 / timeout / network down | Graceful degradation, no stack, no raw provider error | **add** (today only the normal conflict response + refresh failure) |
| E7 | Token refresh | network / 500 (not invalid_grant) | Graceful degradation | **add** |
| E8 | SMTP | Connection refused / auth failure / timeout / 5xx recipient rejected | Friendly, error shown in the card | **add** (today only the pre-send 422) |
| E9 | Recipient | Invalid address (pre-send 422) | Reject, do not send | ✓ `booking-confirmation-email` |
| E10 | Multi-step partial | Booking succeeds, **owner-notify email fails** | Do **not** roll back the booking; record/swallow | **add** (check whether `booking-owner-notify` covers the failure branch) |
| E11 | Multi-step partial | Booking succeeds, **confirmation email fails** | Booking kept, card shows the error | **add** |
| E12 | `mcp-ui:tool` | Host dispatch fails / session invalid / quota runs out mid-action | Friendly inside the card, no hang | **add** (R4 new path) |
| E13 | Idempotency | Repeated cancel / cancel an already cancelled booking | Idempotent; 404 treated as cancelled | Partial ✓ `visitor-cancel-booking` (404) |
| E14 | Idempotency | Confirmation email sent twice | Dedup / explicit semantics | **add** |
| E15 | Mid-stream | SSE interrupted during a connector-backed tool call | Recoverable, no dirty transcript | **add** |

## 5. Retry matrix (third parties are flaky → configure retries per call class, reusing the #132 generic configurable retry infra)

**Base principle:** retry policy = **per-op code configuration** built on top of the **#132 generic configurable retry infra**.
The generic base (backoff/cap/retryable decision/context cancellation) **does not change** — connector operations only "configure" it, never "modify" it.

**Design points (locked):**
- **D-6 (locked): sync vs async is not a global switch — each connector operation declares, on the connector side and according to its own business semantics,
  its own retry mode + budget (code-level, per op).** The confirmation email and owner-notify each pick their own; tests only verify
  "each op behaves according to the policy it declared", and do not pick one global mode for them.
- **D-7 (locked): the sync default is a small budget = 3 attempts, backoff 1s/2s/4s, then graceful degradation. Hard caps, never unbounded:**
  ① attempt cap ② **backoff has a max interval** (no unbounded exponential growth) ③ **total duration cap** (context deadline,
  e.g. ~10s) → stop immediately at the deadline + degrade, even if the backoff has not finished. Async (10×) is the same: both attempt + total duration caps.
  (3/1-2-4/~10s is the sync default; an op can override it within the same capped infra.)
- **Write idempotency**: blind retries of `events.insert`/`smtp send` would double-book/double-send → retry only on "connection failure before sending", or with an idempotency key.

| call | Sync? | Idempotent? | Retry policy | Test |
|---|---|---|---|---|
| `freeBusy` / `list_slots` (read) | sync | Yes | Short budget, fast backoff | Transient error→retry→success; exhausted→degrade |
| `events.insert` (book, write) | sync | **No** | Retry only on pre-send connection failure / idempotency key | **No double booking under retry** |
| `cancel` (delete) | sync | Yes (idempotent) | Short budget | Retry→success; repeated cancel is idempotent |
| token refresh | sync (embedded in the call) | Yes | Short budget, fast backoff; no retry on invalid_grant (degrade directly) | network/500→retry; invalid_grant→no retry→degrade |
| Confirmation email `send_confirmation` | Declared by the op | **No** | Op decides (async→10× long / sync→short budget) | **No double send under retry**; exhausted→card shows the error |
| owner-notify email | async (does not block booking) | **No** | 10× over ~30–60s in the background | Returns as soon as booking succeeds; notify failure retries, **booking is not rolled back** |
| sync ingest (Obsidian) | async | Depends | 10× long (**outside this cut**, #107/#108) | — |

Unit tests for the generic retry infra (#132) itself: backoff calculation, maxAttempts cap, retryable decision (which errors should retry),
context cancellation/timeout interrupting retries, jitter.

## 6. Regression net (run with acceptance, unchanged = proof of behavioral equivalence)

`chat-book-not-connected` · `chat-book-success` · `chat-book-conflict-{busy,policy-hours,policy-leadtime,policy-weekend}` ·
`chat-book-{public,byoai}-denied` · `chat-book-skill-not-granted` · `chat-book-quota-exhausted` ·
`chat-book-schema-rejects-partial` · `chat-book-session-email-default` · `chat-book-token-refresh` ·
`booking-owner-notify` · `connector-{revoked-degrades,add-modal}` · `admin-connectors-extended` ·
`mail-{connector,connector-state,otp}` · `admin-gcal-{oauth-connect,disconnect,policy-edit}` ·
`tool-calendar-cancel-booking` (owner-side facade, unrelated) · `tool-endpoint-calendar-book` · `tool-calendar-list-slots` ·
`visitor-chat-list-slots` (F already migrated) · `mcp-skill-grant-booking` ·
session-block-bundle · the full capability-acl-hierarchy suite

> Note: cells marked ✓ in the state/error matrices whose mechanism changes (gating goes through global, cancel/email go through tools) move to the "rework" bucket and are re-expressed;
> they do not stay in the regression net. Cells marked "Partial ✓" must have their missing branches filled.
