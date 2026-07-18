# ext-mcp — External MCP: register a real remote server + dispatch

- **Status:** ⬜ not started (new round)
- **Module:** the owner registers a real 3rd-party MCP server by URL; the backend dials it over real HTTP transport, enumerates its real tools, gates them by role, honors upstream auth/SSE/large schemas, and a visitor call reaches the real upstream.
- **Surface:** admin/api·mcp (register server) → visitor chat (`ext_<server>_<tool>`).
- **Real dep:** a real reference MCP server (`@modelcontextprotocol/server-everything` or a small FastMCP server) over HTTP/SSE with a bearer token — a process StandMeet did not write. `[MCP]` in verify-creds.
- **Backing e2e:** `admin-mcp-servers` · `external-mcp-tools` · `tool-endpoint-ext-mcp` · `connector-ext-mcp-no-dep` · `tool-roles-mcp` · `mcp-auth` · `real-third-party-mcp-{loader,sandboxed,network,escape}`.

> **Two external-MCP paths — don't conflate.** This is the **registered remote server** path (owner pastes a URL, backend dials over HTTP, tools surface as `ext_<server>_<tool>`). The `real-third-party-mcp-*` suite loads real servers over the **managed-sandbox plugin** loader (bwrap spawn), not the register-a-remote-endpoint path — so sandbox-loader correctness is proven, but the **remote transport + auth + schema round-trip** of a registered server only ever sees the mock.

## Checks

### 1 — Register a real remote server  (was §D1)
- **Steps:** admin/api·mcp → add MCP server → paste the reference server's real URL → save. Backend performs a real `initialize` + `tools/list` handshake over HTTP against a server it didn't write.
- **Expected:** the server appears connected; its real advertised tools are enumerated (not the fixed `echo`/`ping`/`boom` set the mock hands back).
- **⚠️ mock gap:** the register form takes a **URL only** — no auth-token field is captured (`admin-mcp-servers.spec.ts:32`), because the mock requires none. A real bearer-gated server has nowhere to store its token today. **See check 4.**
- **Backing test:** `admin-mcp-servers.spec.ts`
- **Result:** ⬜
### 2 — Expose the server's tools to a role  (was §D2)
- **Steps:** attach the registered server to a visitor role → issue an access code scoped to it → enter chat as that visitor.
- **Expected:** the role's visitor sees `ext_<server>_<tool>`; a role without it does not.
- **Backing test:** `tool-roles-mcp.spec.ts` · `external-mcp-tools.spec.ts`
- **Result:** ⬜
### 3 — dep-grant gate (lowest-trust loader gets no deps)  (was §D3)
- **Steps:** confirm the registered external server is **not** auto-granted connector deps; a tool declaring `_meta.requires:[calendar]` stays gated until explicitly granted.
- **Expected:** ungranted → refused with a friendly gate; granted → dispatches.
- **Backing test:** `connector-ext-mcp-no-dep.spec.ts`
- **Result:** ⬜
### 4 — Real auth + SSE transport + large schema ⭐  (was §D4)
- **Steps (D4a, self-serve):** point at a **bearer-gated** server → a call without/with-wrong token refused upstream, with the correct token succeeds. Then run one over an **SSE-transport** server, and round-trip a tool with a **large/nested `inputSchema`** (arrays, nested objects, enums).
- **Steps (D4b, `manual-only`):** an **OAuth-gated** MCP server (authorization-server metadata + token grant) — document the walkthrough, don't self-serve a full OAuth AS.
- **Expected:** wrong bearer → friendly upstream-auth error (no raw 401 body); SSE stream frames parse; complex schema round-trips.
- **⚠️ mock gap:** `mcp-server-mock` has **no `Authorization`, streamable-HTTP only (no SSE), trivial single-string schemas**. `mcp-auth.spec.ts` covers the backend's **own** inward `/mcp` Bearer — **not** the upstream external server's auth (wrong surface).
- **Backing test:** `mcp-auth.spec.ts` (inward `/mcp` only); no backing spec for upstream bearer/SSE/large-schema (gap).
- **Result:** ⬜
### 5 — Real tool invocation from visitor chat  (was §D5)
- **Steps:** visitor asks something that routes to the real server's tool → backend MCP client dials the real upstream → real `tool_result` renders. Also exercise the per-tool HTTP endpoint (`ext_<server>_<tool>`) directly.
- **Expected:** the visitor sees the real server's real output (not a mock echo); chat-path and direct-endpoint results match.
- **Backing test:** `external-mcp-tools.spec.ts` · `tool-endpoint-ext-mcp.spec.ts`
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The registered-servers **list renders** (name/URL/attached role); add-server fires and the new server appears; a bearer-gated server has a **place to store its token** (F: register form is URL-only).

## Findings
(record here; also log `../findings.md`, ID `F-D-n` historical anchor)

- **✅ PASS (2nd pass):** stood up a genuine `@modelcontextprotocol/server-everything` (streamable-http) on the prod network, registered via `/api/admin/mcp-servers`, granted to a role+code. Visitor turn: backend dialed it, `tools:13` bound, called `ext_everything_echo` → real handshake + result. Also independently confirmed the sandbox-only nature of the old F-A-1 (network-dialed ext MCP works while bwrap builtins failed in the same turn).
