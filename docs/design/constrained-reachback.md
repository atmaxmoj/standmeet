# Constrained reach-back — the kernel-agnostic seal (#135 core)

Status: active. Supersedes the "move the booker cluster" framing in earlier plans.
The falsely-completed tasks #187 / #188 / #189 do NOT hold on the current tree.

## The one root cause

A sandboxed builtin capability reaches back to the host over a unix socket
(`capsocket`). The host lets the capability define what that socket does:

- `capsocket.Server.Handle(op, h)` accepts ANY op name with ANY handler.
- Each capability stands up its OWN socket and registers its OWN verbs.
- Example: the booker plugin registers `book` / `list_slots` / `send_confirmation`
  / `cancel` / `reschedule`; the host implements each host-side in the kernel.

So the reach-back "hand" is unconstrained: the plugin dictates the vocabulary, and
the host obeys. Two consequences follow.

1. The sandboxed plugin becomes a thin name-forwarder. `mcp-servers/booker` runs NO
   business logic; every tool handler forwards to the same-named host op. All booker
   logic (policy, slot math, calendar call, DB write) lives host-side in
   `internal/usecases` — so the kernel is NOT agnostic.
2. A capability consumes a connector by holding a typed proxy. `BookerDeps` holds
   `CalendarProxy` (typed `FreeBusy` / `InsertEvent`), injected from the kernel. The
   connector's typed category contract lives in the kernel; the container's
   resolve-by-name path is bypassed.

There is a second connector-consumption mode that is already generic: the openapi
raw-op path (`Slots.AgentCall` → `CallAgentOp(opID, argsJSON) → json`). The calendar
connector does NOT implement it. So the category-contract mode (`CalendarProxy`) never
got a generic bridge, and booker could not have used the generic path even if it tried.

## The target

The host OWNS one closed reach-back vocabulary. A sandboxed capability may only CALL
those ops; it may never ADD an op. Capability business logic lives in the sandboxed
plugin. The plugin reaches back only through the fixed vocabulary.

Result: the kernel names no capability and no connector category. Writing a
capability-specific host op stops compiling, because `Handle(anyOp)` is gone.

## The fixed reach-back vocabulary

The host exposes exactly these op families. Nothing else is reachable.

- `connector.invoke(category, verb, argsJSON) → json` — resolve the owner's active
  connector for `category`, dispatch `verb`, return the raw result. Covers calendar
  and mail. A verb→method dispatcher lives INSIDE `internal/connector`; the typed
  `CalendarProxy` / `MailProxy` become connector-internal detail, not kernel types.
- `corpus.search / corpus.read / corpus.list(scope, argsJSON) → json` — read the core
  corpus under the session's ACL scope. Covers retrieval.
- `transcript.get(argsJSON) → json` and `llm.complete(argsJSON) → json` — covers
  summarize.
- `capstore.insert / capstore.query / capstore.count(collection, filterJSON) → json` — a
  capability's OWN persistence, isolated per capability. The core has ZERO concept of
  what a capability stores (no "booking" concept). Design (owner-ruled):
  - Reuse the existing Postgres. Do NOT add a database.
  - Each capability and connector gets its OWN schema. The op derives the schema from
    the HOST-trusted id, never from the plugin payload. The plugin request carries no
    table or schema name. So a plugin has NO code path to core tables or another
    capability's tables. This is absolute isolation, especially from core data.
  - Records are generic JSONB documents. The op is booking-agnostic: booker stores a
    booking as a JSONB document in its own collection and queries by JSONB field
    (count by `code_id`, look up by `conversation_id`). The core never names "booking".
  - Optional later hardening: a dedicated low-privilege Postgres role per capability,
    granted only its own schema.

### Schema naming — a structural guardrail (MANDATORY)

Plugin storage schemas carry a RESERVED prefix that marks them as plugin-owned and
NON-core: `connector_<id>` for a connector, `mcp_<id>` for an MCP capability. Core data
lives in `public` and other unprefixed schemas. The prefix is the structural boundary:
core storage never carries it, so a prefix check tells plugin storage apart from core.

### Schema lifecycle — follows the connector / MCP lifecycle

- CREATE the schema when a connector or MCP capability is installed.
- DROP the schema when that connector or MCP capability is uninstalled.
- A missing DROP leaks storage: the schema and its rows outlive the plugin. So the
  uninstall path MUST drop the schema, and a test MUST prove it.

### DROP is dangerous — treat it as core-data-destroying (READ BEFORE EDITING)

`DROP SCHEMA ... CASCADE` deletes every row in the schema. If the schema name is
mis-derived and resolves to `public` or a core schema, the DROP destroys core data. The
drop path therefore has three hard rules. Repeat these rules in the code doc of the
drop function.

1. Derive the schema name from the HOST-trusted id, never from a plugin request.
2. Refuse any name that does not match the reserved plugin prefix
   (`connector_` / `mcp_`). Refuse an empty id. Refuse `public` and any core schema name.
   A name that fails the check is an error, never a DROP.
3. The drop function is the ONLY place a `DROP SCHEMA` runs. No other code drops schemas.

Mandatory tests:
- Leak guard: uninstall a plugin, assert its schema and rows are gone. RED if the
  uninstall path forgets the drop.
- Core-safety guard: call the drop with a non-prefixed name, `public`, and an empty id.
  Assert each is refused and NO schema is dropped. RED if the prefix check is missing.
- `owner.meta(field) → json` — read a whitelisted owner field (e.g. timezone).

The session identity (owner / conversation) stays host-planted on the tool-call
`_meta`, forwarded into each request — never trusted from the LLM.

## Component placement

- The reach-back gateway (the fixed vocabulary, host-owned) is a new host package. It
  depends on `connector`, the corpus listers, `capstore`, the LLM provider, the owner
  getter. The kernel does NOT depend on it.
- The connector verb dispatcher lives in `internal/connector`. It maps
  `(category, verb, args)` to the typed adapter method. The kernel holds no typed
  category contract.
- Each capability's business logic lives in `mcp-servers/<cap>` (its own module).

## Slice order — additive first, seal last, one commit each, `make lint` green each

- S1: build the reach-back gateway with the fixed vocabulary, additively. Back
  `connector.invoke` with a new connector verb dispatcher. Leave the per-cap sockets in
  place. Verify build + a unit test that the op set is closed.
- S2: migrate booker. Move policy / slot math / booking flow into `mcp-servers/booker`.
  The plugin calls `connector.invoke("calendar", …)`, `capstore`, `owner.meta`. Delete
  `RegisterBookerSocket` and the booker host cluster from the kernel. Verify the real
  booking flow on the prod stack.
- S3: migrate mail-sender the same way.
- S4: migrate retrieval onto `corpus.*`.
- S5: migrate summarize onto `transcript.get` + `llm.complete`.
- S6: remove `capsocket.Handle(anyOp)`. The reach-back hand is now closed. Only the
  gateway registers ops.
- S7: add the arch-lint two-port lock. Only the boot composition root and the owner
  GUI / MCP-UI routes may reference capability packages and the connector contract. The
  kernel components may not. Move the typed `CalendarProxy` / `MailProxy` out of the
  kernel into `internal/connector/contract`. Add the core-agnostic grep guard as a
  backstop. Delete the emptied baseline.

## The lock (S7, the invariant that makes drift a red build)

- `go-arch-lint`: the kernel components (`usecases`, `inference`, `agentcore`, `capreg`)
  do not list any `internal/plugins/<cap>` package or `connectorcontract` in
  `mayDependOn`. Only `cmd` (boot) and `mcphandle` / `adminroutes` / `sysroutes` (owner
  GUI / MCP-UI) may.
- The eval mini-host implements the SAME fixed vocabulary, so eval stays faithful.
