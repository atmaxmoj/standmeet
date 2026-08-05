# ext-mcp — External MCP: register a real remote server + dispatch

- **Status:** ✅ e2e-covered — ext.mcp capability enabled; role ext-mcp-verify + code VERIFY-D01 exist; loader present
- **Module:** the owner registers a real 3rd-party MCP server by URL; the backend dials it over real HTTP transport, enumerates its real tools, gates them by role, honors upstream auth/SSE/large schemas, and a visitor call reaches the real upstream.
- **Surface:** admin/api·mcp (register server) → visitor chat (`ext_<server>_<tool>`).
- **Real dep:** a real reference MCP server (`@modelcontextprotocol/server-everything` or a small FastMCP server) over HTTP/SSE with a bearer token — a process StandMeet did not write. `[MCP]` in verify-creds.
- **Backing e2e:** `admin-mcp-servers` · `external-mcp-tools` · `tool-endpoint-ext-mcp` · `connector-ext-mcp-no-dep` · `tool-roles-mcp` · `mcp-auth` · `real-third-party-mcp-{loader,sandboxed,network,escape}`.

> **Two external-MCP paths — don't conflate.** This is the **registered remote server** path (owner pastes a URL, backend dials over HTTP, tools surface as `ext_<server>_<tool>`). The `real-third-party-mcp-*` suite loads real servers over the **managed-sandbox plugin** loader (bwrap spawn), not the register-a-remote-endpoint path — so sandbox-loader correctness is proven, but the **remote transport + auth + schema round-trip** of a registered server only ever sees the mock.

## Checks

### 1 — Register a real remote server  (was §D1)
- **Steps:** admin/api·mcp → add MCP server → paste the reference server's real URL → save. Backend performs a real `initialize` + `tools/list` handshake over HTTP against a server it didn't write.
- **Expected:** the server appears connected; its real advertised tools are enumerated (not the fixed `echo`/`ping`/`boom` set the mock hands back).
- **~~⚠️ mock gap~~ (stale, corrected 2026-08-04):** the note read "the register form takes a **URL only** — no auth-token field is captured". That is **no longer true**: the panel has `mcp-server-auth-name` + `mcp-server-auth-value` (the value field is `type=password`), and the value is sealed at rest. The token *does* have somewhere to live. What was genuinely missing was **coverage** — no spec filled those fields, so the header could have been dropped anywhere between the form and the wire without a single test going red. Closed by `external-mcp-auth-header.spec.ts`.
- **Backing test:** `admin-mcp-servers.spec.ts` · `external-mcp-auth-header.spec.ts`
- **Result:** ✅ — ext.mcp capability enabled; role ext-mcp-verify + code VERIFY-D0 registered a real remote server (prior round).
### 2 — Expose the server's tools to a role  (was §D2)
- **Steps:** attach the registered server to a visitor role → issue an access code scoped to it → enter chat as that visitor.
- **Expected:** the role's visitor sees `ext_<server>_<tool>`; a role without it does not.
- **Backing test:** `tool-roles-mcp.spec.ts` · `external-mcp-tools.spec.ts`
- **Result:** ✅ — server tools exposed to the role (dep-grant flow); ext-mcp-verify role carries 1 mcp server (live on /admin/roles this re-pass).
### 3 — dep-grant gate (lowest-trust loader gets no deps)  (was §D3)
- **Steps:** confirm the registered external server is **not** auto-granted connector deps; a tool declaring `_meta.requires:[calendar]` stays gated until explicitly granted.
- **Expected:** ungranted → refused with a friendly gate; granted → dispatches.
- **Backing test:** `connector-ext-mcp-no-dep.spec.ts`
- **Result:** ✅ — dep-grant gate: lowest-trust loader gets no deps (owner-mcp-deps-capture ordering; e2e).
### 4 — Real auth + SSE transport + large schema ⭐  (was §D4)
- **Steps (D4a, self-serve):** point at a **bearer-gated** server → a call without/with-wrong token refused upstream, with the correct token succeeds. Then run one over an **SSE-transport** server, and round-trip a tool with a **large/nested `inputSchema`** (arrays, nested objects, enums).
- **Steps (D4b, `manual-only`):** an **OAuth-gated** MCP server (authorization-server metadata + token grant) — document the walkthrough, don't self-serve a full OAuth AS.
- **Expected:** wrong bearer → friendly upstream-auth error (no raw 401 body); SSE stream frames parse; complex schema round-trips.
- **⚠️ mock gap (narrowed 2026-08-04):** `mcp-server-mock` now serves a second endpoint `/mcp-auth` that **401s unless the owner-configured header matches**, so the *header-reaches-the-wire* half is machine-checked. Still mock-shaped: it is a fixed header name/value, **streamable-HTTP only (no SSE)**, and **trivial single-string schemas**. `mcp-auth.spec.ts` remains the backend's **own inward** `/mcp` Bearer — a different surface; don't count it here.
- **Backing test:** `external-mcp-auth-header.spec.ts` (upstream header, both directions). No backing spec for **SSE transport** or a **large/nested schema** against a real server — still a gap, see the manual steps below.
- **Result:** ⚠️ **partly covered — the earlier ✅ was wrong.** It cited the `mcp-schema-valid-json` guard, which is about a *malformed InputSchema emptying tools/list* — it says nothing about upstream auth, SSE, or nested schemas. Corrected on 2026-08-04. What is now covered: the owner-entered auth header is really sent, and a wrong one really fails closed. What is **not**: a real third-party bearer, SSE framing, and a deep schema round-trip — those need a real server (steps below).
- **Manual steps (D4a-real, `needs-real-server`):**
  1. Stand up a real third-party MCP server that requires a bearer — `@modelcontextprotocol/server-everything` behind a token-checking reverse proxy is enough; the token goes in `[MCP]` of `~/.config/standmeet/verify-creds.env`.
  2. On **admin → api · mcp**, register it: URL + `Authorization` / `Bearer <token>`. Save.
  3. Attach to a role, issue a code, enter chat as that visitor → the server's **real** tools appear as `ext_<server>_<tool>` and one dispatches end-to-end.
  4. Now edit the same server's token to a wrong value (or revoke it upstream) → re-enter chat. **Expected:** those tools are simply gone, and what the visitor sees is an ordinary "I can't do that" — *not* a raw `401`, not a stack trace, not a stall.
  5. Repeat step 3 against a tool whose `inputSchema` has nested objects/arrays/enums; confirm the arguments the AI sends round-trip intact.
- **Why manual:** e2e cannot supply a credential to a server StandMeet did not write. The mock proves *the header we hold gets sent*; only a real server proves *a real provider accepts it* — and step 4's judgement ("does this read as a normal refusal to a visitor?") is a human read, not an assertion.
- **~~SSE transport~~ — not a coverage gap, a missing feature (established 2026-08-04):** `mcpclient` dials HTTP through `NewStreamableHttpClient` and nothing else; there is no SSE client anywhere in the tree. So "verify SSE against a real server" was never a test we were failing to run — it is a transport we do not implement, and an owner who pastes an SSE-only URL gets a dial failure with no explanation. Streamable HTTP superseded HTTP+SSE in the MCP spec, so most current remote servers are fine; the open question is whether back-compat with SSE-only servers is worth building. **Product decision, not a check.**
### 5 — Real tool invocation from visitor chat  (was §D5)
- **Steps:** visitor asks something that routes to the real server's tool → backend MCP client dials the real upstream → real `tool_result` renders. Also exercise the per-tool HTTP endpoint (`ext_<server>_<tool>`) directly.
- **Expected:** the visitor sees the real server's real output (not a mock echo); chat-path and direct-endpoint results match.
- **Backing test:** `external-mcp-tools.spec.ts` · `tool-endpoint-ext-mcp.spec.ts`
- **Result:** ✅ — real tool invocation from visitor chat (ext-mcp round).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The registered-servers **list renders** (name/URL/attached role); add-server fires and the new server appears; a bearer-gated server has a **place to store its token** (it does: auth header name + value, value masked).

Look at what the list tells the owner about a server that is **currently failing to authenticate**. Today the row looks identical whether the token is good or stale — the tools just quietly stop appearing for visitors, and nothing on this page says so. An owner whose token expired has no way to find that out from here.

## Findings
(record here; also log `../findings.md`, ID `F-D-n` historical anchor)

- **✅ PASS (2nd pass):** stood up a genuine `@modelcontextprotocol/server-everything` (streamable-http) on the prod network, registered via `/api/admin/mcp-servers`, granted to a role+code. Visitor turn: backend dialed it, `tools:13` bound, called `ext_everything_echo` → real handshake + result. Also independently confirmed the sandbox-only nature of the old F-A-1 (network-dialed ext MCP works while bwrap builtins failed in the same turn).
