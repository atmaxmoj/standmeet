# ext-mcp — External MCP: register a real remote server + dispatch

- **Module:** The owner registers a third-party MCP server by URL. The backend dials it over real transport, enumerates its real tools, gates them by role, carries the owner's auth header upstream, and a visitor's call reaches the real server.
- **Surface:** `/admin/api-mcp` to register, and visitor chat where the tools appear namespaced to the server.
- **Real dep:** A real remote MCP server that StandMeet did not write, reachable over streamable HTTP and gated by a **static header** — the register form stores one header name and value, so anything OAuth-gated cannot be driven through it at all. Keep the token in the verify-creds file.
- **Backing e2e:** `admin-mcp-servers` · `external-mcp-tools` · `external-mcp-auth-header` · `tool-endpoint-ext-mcp` · `connector-ext-mcp-no-dep` · `tool-roles-mcp`.

## Checks

### 1 — A real remote server registers and enumerates its own tools ⭐
- **Steps:** Open the register form. Paste a real server's URL, its header name and its token. Save. Press the row's **check** and read the tool list the backend enumerated.
- **Expected:** The row states that the server answers and names its real advertised tools — the ones that server actually publishes, not a fixed set. It is a read-only probe: it dials and lists, it changes nothing.
- **Backing test:** `admin-mcp-servers.spec.ts`

### 2 — The tools reach exactly the roles that were given them
- **Steps:** Attach the server to one role. Issue a code on it and enter chat. Then enter on a role without it.
- **Expected:** The first visitor sees the server's tools, namespaced to the server. The second sees none.
- **Backing test:** `tool-roles-mcp.spec.ts` · `external-mcp-tools.spec.ts`

### 3 — A remote server gets no connector dependencies for free
- **Steps:** Register a server whose tool declares a dependency on a connector. Call it without granting that dependency. Then grant it and call again.
- **Expected:** Ungranted, the call is refused at the gate with a friendly message. Granted, it dispatches. The lowest-trust loader never inherits deps.
- **Backing test:** `connector-ext-mcp-no-dep.spec.ts`

### 4 — The owner's token really reaches the upstream, both ways ⭐
- **Steps:** Register a real bearer-gated server with the correct token. Enter chat and dispatch one of its tools. Then change the token to a wrong value, or revoke it upstream, and enter again.
- **Expected:** With the right token the call reaches the real server and returns its real result. With a wrong one, the tools are simply absent and the visitor gets an ordinary refusal — never a raw upstream status, never a stack trace, never a stall.
- **Mock gap:** The mock proves the header we hold gets sent, with a fixed name and value. Only a real server proves a real provider accepts it, and whether the failure reads as a normal refusal is a human judgement, not an assertion.
- **Backing test:** `external-mcp-auth-header.spec.ts` (mock, both directions) · a real provider → `gap`

### 5 — A deep schema round-trips
- **Steps:** Dispatch a tool whose input schema carries nested objects, arrays and enums. Read what the model sent and what the server received.
- **Expected:** The arguments arrive intact and correctly typed.
- **Mock gap:** The mock's schemas are single strings, so nesting has never been exercised.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The register form takes a URL and an auth header, and the token field is masked.
A registered server can be asked whether it is reachable, so a dial failure is visible where the owner registered it — and an instance that cannot probe at all says so, rather than reporting the server as silent.
When a server's tools disappear because its credential stopped working, the visitor's experience is an ordinary refusal, not an error surface.

## Note

Two different external-MCP paths exist and must not be conflated. This item covers the **registered
remote server** — the owner pastes a URL and the backend dials it over HTTP. The sandbox-loader
suite loads real servers as managed plugins through a spawn, which proves loader isolation and says
nothing about remote transport, auth or schema round-trips.

Two transports are tried, in order: streamable HTTP first, then the older HTTP+SSE endpoint
(`backend/internal/capabilities/mcpclient/dial.go`). Both share one dial budget, so an SSE-only
URL now connects rather than failing — `F-D-3` closed. Picking a server for check 4 still means
picking one that authenticates by **header**; a server that authenticates by query string never
exercises the header at all.
