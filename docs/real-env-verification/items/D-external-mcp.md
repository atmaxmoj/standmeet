# §D — Real external MCP server

- **Status:** ⬜ not-run
- **Scope:** self-serve (🟡) — stand up a **real off-the-shelf MCP server** locally; no vendor credential to purchase.
- **Prereqs/creds:** `verify-creds.env` → `[MCP]`. Self-serve: run a **reference MCP server** (e.g. `@modelcontextprotocol/server-everything`, or a small FastMCP/`mcp` Python server) locally, exposed over **HTTP/SSE with a bearer token** — a real process StandMeet did **not** write, distinct from the in-repo `mcp-server-mock`. Register it in admin/api·mcp with its URL. **Full OAuth-gating (Dynamic Client Registration / authorization-server metadata / token exchange) is not cheaply self-servable** → that sub-part is marked `manual-only` (D4b); bearer-token gating IS self-servable.
- **Real service:** a real 3rd-party MCP server over real transport, replacing `mcp-server-mock` (`mock-stack/mcp/main.go`, port 9100).
- **Backing e2e:** (attribution targets) `admin-mcp-servers` · `external-mcp-tools` · `tool-endpoint-ext-mcp` · `connector-ext-mcp-no-dep` · `tool-roles-mcp` · `mcp-auth` · `real-third-party-mcp-{loader,sandboxed,network,escape}`

> **Two distinct external-MCP paths — don't conflate them.** §D is the **registered remote server** path: owner pastes a URL in admin/api·mcp (`admin-mcp-servers.spec.ts`), the backend MCP client dials it over HTTP, and its tools surface as `ext_<server>_<tool>` in visitor chat. The `real-third-party-mcp-*.spec.ts` suite already loads real reference servers (`server-everything`, `server-filesystem`, `fetch`) but over the **managed-sandbox plugin** loader (local bwrap spawn), not the register-a-remote-HTTP-endpoint path. So the sandbox-loader correctness is genuinely proven against reality; the **remote transport + auth + schema round-trip** of a registered server is what only ever sees the mock.
>
> One-time setup: run the reference server locally (bind an HTTP/SSE port, set a static bearer). On the prod stack, claim owner → admin/api·mcp → register the server URL → attach it to a role → issue a code for that role. Only then can the sub-items run.

## Sub-items

### D1 — Register a real remote server
- **Steps:** admin/api·mcp → add MCP server → paste the reference server's real URL → save. Backend performs a real `initialize` + `tools/list` handshake over HTTP against a server it didn't write.
- **Expected:** the server appears connected; its real advertised tools are enumerated (not the fixed `echo`/`ping`/`boom` set the mock hands back).
- **⚠️ mock gap:** the register form takes a **URL only** — no auth-token field is captured (`admin-mcp-servers.spec.ts:32` fills just `mcp-server-url`), because the mock requires none. A real bearer-gated server has nowhere to store its token today. **Finding candidate — see D4.**
- **Backing test:** `admin-mcp-servers.spec.ts` (CRUD against `mcp-server-mock`)
- **Result:** ⬜

### D2 — Expose the server's tools to a role
- **Steps:** attach the registered server to a visitor role → issue an access code scoped to it → enter chat as that visitor.
- **Expected:** the role's visitor sees `ext_<server>_<tool>` available; a role without it does not.
- **Backing test:** `tool-roles-mcp.spec.ts` · `external-mcp-tools.spec.ts`
- **Result:** ⬜

### D3 — dep-grant gate (lowest-trust loader gets no deps)
- **Steps:** confirm the registered external server (someone else's process the owner merely pointed at) is **not** auto-granted connector deps (calendar, mail, …); a tool declaring `_meta.requires:[calendar]` stays gated until explicitly granted.
- **Expected:** ungranted → refused with a friendly gate message; granted → dispatches.
- **Backing test:** `connector-ext-mcp-no-dep.spec.ts`
- **Result:** ⬜

### D4 — Real auth + SSE transport + large schema ⭐
- **Steps (D4a, self-serve):** point at a **bearer-gated** reference server → a call **without/with wrong** token must be refused upstream, **with** the correct token must succeed. Then run one over an **SSE-transport** server (not streamable-HTTP), and round-trip a tool with a **large/nested `inputSchema`** (arrays, nested objects, enums) → the schema survives `tools/list` and validates a real call.
- **Steps (D4b, `manual-only`):** an **OAuth-gated** MCP server (authorization-server metadata + token grant). Self-serving a full OAuth AS is disproportionate; document the manual walkthrough instead of a spec.
- **Expected:** wrong bearer → friendly upstream-auth error (no crash, no raw 401 body); SSE stream frames parse; complex schema round-trips byte-for-shape.
- **⚠️ mock gap:** `mcp-server-mock` has **no `Authorization` requirement, streamable-HTTP only (no SSE), and trivial single-string schemas** (`mock-stack/mcp/main.go`: `NewStreamableHTTPServer` at :86, tools are `echo`/`ping`/`boom` with one `WithString`). So bearer-refusal, SSE framing, and non-trivial schema round-trip are **entirely unproven**. `mcp-auth.spec.ts` covers the backend's **own** inward `/mcp` Bearer (the owner surface), **not** the upstream external server's auth — do not mistake it for D4 coverage. **High-value Finding candidate.**
- **Backing test:** `mcp-auth.spec.ts` (inward `/mcp` only — attribution note: wrong surface); no backing spec for upstream bearer/SSE/large-schema (gap).
- **Result:** ⬜

### D5 — Real tool invocation from visitor chat
- **Steps:** visitor asks something that routes to the real server's tool → backend MCP client dials the real upstream → real `tool_result` renders in the transcript. Also exercise the per-tool HTTP endpoint (`ext_<server>_<tool>`) directly.
- **Expected:** the visitor sees the real server's real output (not a mock echo); the chat-path and direct-endpoint results match.
- **Backing test:** `external-mcp-tools.spec.ts` · `tool-endpoint-ext-mcp.spec.ts`
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-D-n`)
