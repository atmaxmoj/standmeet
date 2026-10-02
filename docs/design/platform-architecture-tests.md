# StandMeet platform architecture — test design

> **Status:** Draft, awaiting review (2026-06-18). Read together with [`platform-architecture.md`](platform-architecture.md).
> **Readers:** people writing mock plugin servers / fixtures / specs.
> **How to give feedback:** each section ends with a `T.n` decision point; reply `Tn: accept` / `Tn: change — <…>`.

---

## TL;DR — test philosophy

0. **The first step of every phase is writing tests, and they must be comprehensive (iron rule).** Before any phase touches implementation, write the **complete test suite** and keep it red:
   - **happy flow** — the normal path holds.
   - **corner cases** — full coverage: empty/missing fields, boundary values, concurrency, duplicates, unauthorized, not connected, quota exhausted, version mismatch, name collision, degraded-but-visible, idempotency.
   - **error stream (failure partway through)** — in a streaming/multi-step chain, **any step crashing** stays controlled: a tool call failing midway, a connector proxied call failing, a plugin process exiting mid-session, an SSE stream interrupted, a dependency dropping mid-turn, timeouts. Each needs a test case, and the UI/agent behavior is **graceful degradation**, not a stack trace / hang.
   Coverage not in place = the phase has not started. Red first, then green (CLAUDE.md: untested = unfinished).
   - **Check against the feature floor item by item**; don't review only against "what this thing does". Every visitor-facing capability must walk the floor checklist: **ACL via role, connector dependencies, quota, mode (code/public/byoai), capability_state, degraded-but-visible** — every applicable item needs a test case. (Lesson: C3 missed ACL because it was reviewed only against "plugin dial/list/wrap", not against the floor → missed test → missed implementation. The floor is the checklist.)

1. **e2e is the only proof of a feature (CLAUDE.md).** "Core discovered a capability it did not hard-code" must have a **browser-driven** e2e: a real visitor enters chat → the AI calls a tool that is **declared in config, not `MustRegister`** → the answer is correct. This is C4, the main proof of this feature.
2. **The protocol plumbing layer gets extra unit/integration tests, but not as primary coverage.** Manifest parsing, stdio frame read/write, the version gate — these are combinatorially explosive pure plumbing (malformed JSON / version mismatch / process exit); running them in a browser is slow and incomplete. They are **supplementary fast tests** like booking_confirmation_test.go and do not replace e2e. Precedents exist: `inference` / `mailer` / `booking_confirmation` all have unit tests.
3. **Plugins are real external dependencies → don't mock at the mcpclient layer; mock at the transport boundary.** Same idea as external-mock: **the mcpclient code is real**; it only connects to/launches a **real MCP server** we wrote (speaking real JSON-RPC, real stdio/http), and only its *content* is a fixture (an echo/marker tool). Never stub `Session`.
4. **Zero ifs, zero sleeps (project rule).** Unit tests use testify `require.*`; e2e waits for UI state, never `setTimeout`-as-sleep.
5. **Name tests by behavior**, not by commit: `plugin-discovery-chat.spec.ts`, not `c4.spec.ts`.

**Decision point T.0: every phase first writes comprehensive tests (happy + corner cases + error stream), red, then implements. Incomplete coverage = the phase has not started.**
**Decision point T.1: the philosophy above is accepted.**

---

## Test double — `mock-mcp-plugin` (a real MCP server)

Add `backend/cmd/mock-mcp-plugin` (reusing the backend binary, **not** node). It speaks **real MCP**: `initialize` + `tools/list` (returns one `echo` tool: takes `{text}`, returns `{"echoed": "<MARKER>:<text>"}`) + `tools/call`.

**Two modes, one piece of logic:**
- `--stdio` → over stdin/stdout (newline-delimited), for the C2/C4 stdio path — core launches it as a child process.
- `--http :PORT` → Streamable HTTP single endpoint, for the C3/C4 http path + ext-mcp regression.

**Fault-injection switches (env vars / flags, for the "failure partway through" cases):**
- `MOCK_PLUGIN_PROTOCOL_VERSION=<v>` — makes initialize return an **incompatible version** → tests the version gate.
- `MOCK_PLUGIN_FAIL=call` — `tools/call` returns an MCP error → tests folding call-time errors into errJSON.
- `MOCK_PLUGIN_FAIL=list` — `tools/list` errors → tests silently skipping a discovery-time failure.
- `MOCK_PLUGIN_EXIT_AFTER=1` — the process exits after one call → tests the session dying midway.
- `MOCK_PLUGIN_TOOL_NAME=<name>` — changes the tool name it exposes → tests **shadowing** (declaring a tool/capability id that collides with a built-in).

**Decision point T.2: one `mock-mcp-plugin` binary, two modes stdio+http, fixture = one echo/marker tool, faults via env switches.**

---

## C1 — manifest + discovery source + version gate (unit, testify, zero ifs)

File: `backend/internal/plugins/manifest_test.go` (external test package).

| Test | Assertion |
|---|---|
| `ParseConfig_StdioAndHttp` | A config with 1 stdio + 1 http → 2 manifests, each field (id/version/shape/transport.Kind/command/url) exact |
| `ParseConfig_MalformedJSON` | Malformed JSON → returns an error (require.Error) |
| `ParseConfig_UnknownTransportKind` | `kind:"carrier-pigeon"` → that entry is rejected (require.Error or not in the list; pick one and fix it) |
| `ParseConfig_MissingRequiredID` | Missing id → rejected |
| `ParseConfig_DuplicateID` | Duplicate id within one config → rejected |
| `Source_VersionIncompatible_Skipped` | An incompatible version entry → **not** in the returned list, and there **is** a log (not silently dropped) |
| `Source_Empty_NoError` | Config missing / empty → empty slice + nil error (deployments have no plugins by default; valid) |
| `Source_MixedValidInvalid` | One good, one bad → the good one is in the list, the bad one filtered, list length=1 |

Pure data layer; no Registry, no server.

**Decision point T.3: C1 is all unit tests, covering the combinatorial boundaries of manifest parsing + the version gate.**

---

## C2 — mcpclient transport abstraction + stdio (integration, real mock server)

File: `backend/internal/mcpclient/stdio_test.go`. Runs against a real `mock-mcp-plugin --stdio`.

| Test | Assertion |
|---|---|
| `Stdio_Initialize_ListTools` | Launch the child process → initialize succeeds → ListTools contains `echo`, inputSchema correct |
| `Stdio_CallTool_Echo` | CallTool(`echo`,`{text:"hi"}`) → result contains `MARKER:hi` |
| `Stdio_StderrIgnored` | The server writes logs to stderr → stdout frame parsing is not broken; CallTool still OK |
| `Stdio_ProcessExitMidSession` | `MOCK_PLUGIN_EXIT_AFTER=1` → the second CallTool returns a **clean error** (no hang, no panic) |
| `Stdio_Close_ReapsProcess` | Session.Close → the child process is reaped (no zombie; check the wait return) |
| `Transport_ParitySmoke` | Run the same Session API over stdio and assert the same shape as http (ListTools/CallTool return structures match) |

HTTP path regression: run the existing ext-mcp e2e (already covers http) to confirm that extracting Transport broke nothing.

**Decision point T.4: C2 uses a real child process, covering three easy-to-miss stdio points: stderr / exit midway / process reaping.**

---

## C3 — `pluginCapability` adapter (integration)

File: `backend/internal/usecases/plugin_capability_test.go`.

| Test | Assertion |
|---|---|
| `PluginCap_Binding_HasTool` | manifest (pointing at the mock http plugin) → VisitorBinding → Binding.Tools contains the namespaced echo tool |
| `PluginCap_UIMeta_IntoExtra` | manifest with `ui{resourceUri}` → CapabilityState.Extra carries ui.resourceUri (#134 hook point) |
| `PluginCap_DialFail_Hidden` | Bad command/url → returns `ErrHidden` (silently skip, does not block chat) |
| `PluginCap_ListFail_Hidden` | `MOCK_PLUGIN_FAIL=list` → ErrHidden |
| `PluginCap_CallError_FoldedToToolResult` | `MOCK_PLUGIN_FAIL=call` → CallTool folds into an errJSON tool_result, **Go err = nil** (the single ext-mcp invariant) |
| `PluginCap_Origin_Managed` | Registered through RegisterDiscoveredPlugins → ListByOrigin(managed) contains it; ListByOrigin(builtin) does not |
| `PluginCap_ShadowBuiltin_BuiltinWins` | Plugin id collides with a built-in → registration rejected + log; the built-in remains, and that id in List is still builtin |
| `ExtMCP_Regression` | All existing ext-mcp tests green (proves the generalization did not regress) |

**Decision point T.5: C3 covers the three "failure partway through" points dial/list/call + origin distinction + anti-shadowing.**

---

## C4 — boot discovery + e2e (browser-driven, main proof)

File: `e2e/test/plugin-discovery-chat.spec.ts`. docker-compose brings up `mock-mcp-plugin` (one service in http mode; stdio mode is spawned by the backend), and the config file declares it.

| Test | Assertion |
|---|---|
| `A plugin tool declared in config is called by the AI in visitor chat` | A real visitor enters chat → the script makes the mock LLM call that plugin tool → the answer contains `MARKER` → **core discovered a non-MustRegister capability** (main proof) |
| `The tool is not in the built-in list` | In the capability map / admin it carries an **origin=managed badge**, distinguishable from the built-in badge (answers your question "how do we tell them apart") |
| `Plugin server down, chat does not crash` | Plugin unreachable at session start → chat works normally with other tools, the plugin tool is absent, **no stack trace / graceful degradation** |
| `A plugin with a version mismatch is not registered; the rest works` | Put an incompatible-version entry in the config → it does not appear; the rest of chat is normal |
| `Plugin collides with a built-in id → built-in wins` | The config declares a plugin whose id collides with a built-in → chat calls the **built-in behavior**; the plugin is rejected (visible in the boot log) |
| `stdio plugins can also be discovered and called` | The same mock server `--stdio`, spawned by the backend → the tool is equally usable (covers stdio end to end) |

**The "failure partway through" matrix is complete:** failure at discovery (unreachable / version mismatch / name collision), failure at call time (C3's call-fail folded into tool_result; in e2e it shows as the AI receiving the error and answering another way), failure mid-session (C2's process exit).

**Decision point T.6: C4's first e2e is the main proof of this feature; the origin badge test directly answers "how do we tell built-ins from plugins".**

---

## Isolation / determinism

- Every spec uses the existing `resetInstance` + its own owner/code, and does not share plugin configuration with other specs.
- The mock plugin's fault switches are **process-level env**; specs start server instances with different configs and do not rely on switching state at runtime (avoids cross-spec races — see the `no-rerun-on-flake` lesson).
- e2e waits for UI state / network responses, zero `setTimeout`-as-sleep; unit tests have zero ifs.

**Decision point T.7: fault injection works by "starting a server instance with that env", not by switching state from an admin endpoint at runtime.**

---

## Driver / independent launch (Bridge invariants, corresponding to P.13)

C1–C4 test "externalizing capabilities/plugins". P.13 is a different cut: **the agent core is an independently launchable module, with its environment injected through a Bridge/Driver**.
Below, each of P.13's four invariants is checked one by one (not reviewed against "what it does" — see the floor lesson on line 16 of the TL;DR).

Test double: **`EvalDriver`** — the canned implementation of `agentcore.Driver` in eval-harness (hard-coded stdout /
fake booking / .env cred / in-memory corpus). It **is** the ConcreteImplementor P.13 talks about, not an extra mock.

| Invariant | How to test | File / gate |
|---|---|---|
| ② **Backend has zero fixtures** | Extend `check-no-mock` into a real gate: grepping `canned*` / `*Fixture` / `stub*` names in `backend/` (**including agentcore**) turns it red. After the cleanup agentcore has none of these; all canned data lives in eval-harness. **This should have caught the fixture welded into agentcore today (the named blacklist missed it).** | `infra/scripts/check-no-mock` (lint gate) |
| ① **Driver leaks zero `internal/` = independent** | eval-harness (**its own go.mod**) implements `agentcore.Driver` and **compiles** — if the Driver interface leaked any `internal/*` type, an external module could not compile at all (Go's internal iron rule). **Compiling is the proof**; no extra assertion needed. | eval-harness `go build` (CI) |
| ③ **prod / eval use the same `Launch` + faithful** | Promote `eval-smoke` to a **mandatory gate**: the tool set of the agent launched by EvalDriver = **real capreg assembly** (not simplified stub tools), the prompt = **real `ComposeSystemPrompt`** (when the override is empty); scripted tool+reply, asserting a complete transcript round-trip. Proves eval and prod go through the same `Launch(driver,…)` and the same real assembly. | `eval-harness/smoke.sh` (from a manual target → CI gate) |
| **Parallel prompt injection** (the original requirement) | smoke: N processes each inject `SystemPromptOverride=variant_i`, `Launch` **at the same time**, each runs through, with no state crossover → proves "launch the agent on its own and try prompts in parallel across processes" really holds. | `eval-harness` (new smoke) |
| **The floor must still be checked** | Under EvalDriver injection, the capability floor (ACL via role / connector-dep gate / quota / mode) behaves **the same as prod** — don't only test "the driver can launch"; test "after launch the capability floor does not collapse". Reuse the capability-acl / connector-deps cases and rerun the key ones with EvalDriver injection. | eval-harness integration |

**Decision point T.8: Driver independence = proof by compilation (eval-harness compiles = zero internal leaks); `eval-smoke` is promoted from a manual
target to a CI gate (live proof of "independent launch + same Launch + faithful real assembly"); backend-zero-fixtures relies on extending
`check-no-mock` into a lint gate (which also catches the canned data welded into agentcore today).**

**Decision point T.9: "Parallel prompt injection" needs a dedicated smoke (N processes, each injecting a different override, launched at the same time), because this is exactly the **original motivation** for making the agent
core independent — not proving it means not proving that the independence delivered what we wanted.**
