# Q5 — MCP client self-update / version-skew

Status: **design 2026-09-06.** Owner: "instance update 的时候,会不会给自己这个 mcp(-client) 也 update,
有时候就是应该会变的。"

## The problem
`instance.upgrade` recreates the **instance** containers (backend/app/…). The **mcp-client**
(`sdk/packages/mcp-client`, running on the owner's machine / registered in Claude Code) is a separate
artifact — it does NOT update with the instance. The client is a thin **signed forwarder**
(`bridge.ts`: stdio JSON-RPC ↔ HTTP; tools come from the server via `tools/list`), so mild skew is
harmless: a slightly-old client keeps working because tools are server-authoritative. Skew only
BREAKS the client when the **transport or the signing scheme** changes (e.g. SigV1 → SigV2) — then an
old client can't authenticate the new server.

## Reference (youteacher solved this)
`youteacher_mcp/src/tools/updateSelf.ts`: an MCP tool that downloads the latest client tarball from
the connected env (admin-gated `/api/mcp-package`), `npm i -g`, and **exits ~250ms after responding**
so the MCP client respawns it with the new binary on the next call. Clean self-update, owner-driven.

## Implementation plan (staged; two layers)
1. **Skew detection + warning (cheap, do first).** The client already learns the server version from
   `initialize` (`serverInfo.version`). Have the client compare it to its own package version and, on
   mismatch beyond a compatibility floor, **surface a warning** in the tool response ("this MCP client
   is vX; the instance is vY — run `standmeet.update_self`"). Never silently fail. A hard floor
   (min-compatible client version the server advertises) turns a would-be auth break into a clear
   message.
2. **`update_self` tool (youteacher pattern).** Add an MCP tool that pulls the latest client package
   from the instance (a new admin-gated `/api/mcp-package` serving the pinned client tarball for the
   running instance version), `npm i -g`, and exits after responding so the client respawns updated.
   Owner-driven (a tool call), not automatic — the owner decides.
3. **Server advertises min-compatible client version** in `initialize`/`instance.upgrade_check`, so
   the client can decide warn vs. hard-stop.

## Test plan (test-first, RED-reachable)
### Unit
- **U1 skew compare:** given (clientVersion, serverVersion, minCompatible), the classifier returns
  ok / warn / incompatible correctly across the boundary cases (equal, client older within floor,
  client older below floor, client newer). Pure function.
- **U2 warning surfaced:** when classified warn/incompatible, the client attaches the advisory to the
  tool response (assert the message text + that it names `update_self`). Never swallowed.
### Integration (mocked env)
- **I1 update_self flow:** against a mock `/api/mcp-package` serving a v2 tarball, `update_self`
  downloads + installs to a temp global prefix + the process exits with the "respawn me" signal
  (assert the new binary is in place + a clean exit code). Mock npm/prefix; do not touch the real
  global.
- **I2 server floor honored:** a server advertising minCompatible > client → the client hard-warns
  (incompatible), not a raw auth 401 ([[c3-stdio-sdk-sigv1-401]]: never hand-sign around the client).
### RED-reachability
- Bumping the mock server's version past the floor with no skew handling → U2/I2 go RED (silent
  failure or raw 401 instead of a clear advisory).

## Open decision
Auto-offer update on skew (client prints the advisory every call until updated) vs. only on
`upgrade_check`. Recommend **advisory on skew, action on explicit `update_self`** — owner-driven,
matches youteacher + the "product-owned, owner-triggered" upgrade philosophy.
