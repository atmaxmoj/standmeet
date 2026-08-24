# visitor-mcp — a visitor points their own AI client at this instance

- **Module:** The outward MCP face at `/mcp/visitor`. Someone holding an access code configures their own AI client (Claude Desktop, Cursor, the MCP Inspector) against the owner's instance and gets that code's tools. The code is unchanged by this — same grant, same role, same quotas, same transcript; only who is driving the model differs.
- **Surface:** `/mcp/visitor` reached through the public entry point, plus `/admin/conversations` and `/admin/codes` on the owner's side.
- **Real dep:** The prod stack, real corpus (the owner's own vault mirror), and **a real third-party MCP client** — not our own `standmeet-mcp` bridge, which speaks Sigv1 and is the owner's path. The whole claim of this module is that a client we did not write connects; driving it with our own client proves nothing about that.
- **Backing e2e:** `visitor-mcp`.

## Checks

### 1 — A client we did not write connects with nothing but a code ⭐
- **Steps:** From a shell, point the official MCP Inspector CLI at the public entry point with `Authorization: Bearer <code>` and ask for `tools/list`. Use no other credential.
- **Expected:** The handshake completes and the client is handed a tool list. The names are the outward set (`corpus_search` / `corpus_read` / `corpus_list` / `corpus_links` / `calendar_*`) — nothing else.
- **Note:** the negative is the half that matters. **Every name on that list must be an outward tool.** The owner MCP face and this one live in one process and differ by a URL prefix, so an owner tool reaching this wire is a plausible mistake, not a theoretical one.
- **Backing test:** `visitor-mcp.spec.ts`

### 2 — A tool call returns this owner's real corpus ⭐
- **Steps:** Through the same client, call `corpus_search` with a phrase the owner has actually written about.
- **Expected:** Real entries come back — paths, titles, summaries from the live corpus. Not an empty array, not a stub.
- **Mock gap:** CI can assert a call succeeds. It cannot assert the result is this owner's corpus rather than a fixture, and it cannot assert a foreign client's transport framing is accepted.
- **Backing test:** `visitor-mcp.spec.ts` (protocol only)

### 3 — The owner can tell who came in this way
- **Steps:** Send `X-Standmeet-Visitor: <name>` on the connection. Then read `/admin/conversations`.
- **Expected:** The session appears under that code, attributed to that name. An owner must not have to guess which surface a transcript came from, and a client with no identity prompt must still leave one.
- **Note:** MCP has no UI to pop a who's-reading dialog, so the header is the only way a name can arrive. With no header the visitor is anonymous — the same person as someone who clicks skip on the web picker, not an error.
- **Backing test:** `visitor-mcp.spec.ts`

### 4 — Everything the code carries carries here too
- **Steps:** Revoke the code while a client is configured against it and reconnect. Separately, set `max_members: 1` and connect a second name.
- **Expected:** The revoked code stops opening the face. The full code admits no new name. Each behaves exactly as it does in chat with the same code.
- **Note:** write it against chat as the oracle, not against fresh expectations — the assertion is "this face does what the same code does in chat", so a change to code semantics moves both and cannot drift into an MCP-only branch.
- **Backing test:** `visitor-mcp.spec.ts`

### 5 — The refusals say the same words as the other faces
- **Steps:** Connect with no `Authorization` at all. Then with a code that does not exist.
- **Expected:** No credential names what to bring. A bad code gets the same sentence the web path gives a typo — the one that points at the next step, not a status code. The client has no UI of its own, so that sentence is the entire message the person receives.
- **Backing test:** `visitor-mcp.spec.ts`

### 6 — It is reachable the way a visitor actually reaches it
- **Steps:** Use the **public entry point** (the port the owner fronts with TLS), not the backend's internal port.
- **Expected:** It answers. A face that only works against the internal backend is a face no visitor can use.
- **Note:** worth its own check because the backend is not published in the prod compose — only the app is. This passes only because the app proxies `/mcp/:path*`.
- **Backing test:** `gap` — CI drives the backend directly, so the proxy hop is not exercised there.

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

There is no UI on this face, which is itself the thing to look at: everything the person will ever see is the tool names, their descriptions, and the refusal sentences. Read them as someone who has only those.
Do the descriptions say what the tool does, or only that it is scoped?
Does a refusal tell them what to do next, or just that they were refused?
Is there anywhere in the owner's panel that tells them this face exists and that a code can be used this way? If not, the capability is real and undiscoverable.
