# Owner-API JWT layer (defense-in-depth)

Status: **seed / requested 2026-09-06** by the owner, straight out of the security question
"why is there no mechanism to stop you from going at my prod through a side API?"

## Motivation

Today an owner-side request is trusted on ONE factor:
- GUI → a login **session cookie** (minted from the owner password),
- MCP → an **ed25519 SigV1** per-request signature (the owner-provisioned key).

Both are enough on their own, so anything holding the raw material — the owner's password in a
creds file, a leaked admin session, a naked `curl`/script — can drive the owner API directly. That
is exactly the "从中间弄" (side-channel) path the agent kept taking (Coolify API, `curl POST
/api/admin/...`). The product could not tell the legitimate front doors apart from a raw call.

## The layer

Add a **second, additive factor** on owner-side endpoints: an **instance-signed JWT** that only the
real front doors (GUI login, MCP client) mint. A request without a valid JWT is refused with a
message telling the caller to **use the MCP client or the admin GUI**. This does NOT replace SigV1
or the session — it is layered on top, owner-side only (visitor/public surfaces are untouched).

### The token
- **Per-instance salt**: each instance generates its own random salt at claim/boot, stored
  server-side, **never exported** (not in any creds file, not returned by any API). It is the HMAC
  signing secret. → a JWT from instance A is invalid on instance B; nobody without server access
  can forge one offline.
- **Claims**: `iat` + `exp` (short-lived, time-bound — the "加上时间"), `iss` = this instance id,
  `sub` = owner id, `aud` = `owner-api`, and `via` = `gui` | `mcp` (which door minted it; for `mcp`
  also the `key_id`, so an action stays attributable/revocable). ("各种信息" = these claims.)
- Signed HS256 with the instance salt.

### Mint points (the two legitimate doors)
- **GUI**: on a successful owner login, issue the JWT next to the session; the admin app sends it as
  a header (e.g. `Authorization: … ` / `X-Owner-JWT`) on every owner-API call.
- **MCP**: the mcp-client, once its SigV1 handshake verifies, obtains the JWT (server mints it from
  the verified signature) and carries it on subsequent calls. The provisioned, revocable key is what
  earns the token.

### Verify
- Middleware on the owner-route group: require a valid JWT (good signature under the instance salt,
  not expired, `aud=owner-api`). Missing/invalid/expired/wrong-instance → **401** with a
  human-readable body: **"use the MCP client or the admin GUI to operate."**

## The load-bearing open question (needs the owner's call)

**What gates the GUI mint — the password alone, or the existing human check (turnstile)?**
- If **password alone** mints the JWT, then an agent that holds the password can still complete the
  login flow headless and get a JWT → the layer raises the bar but does not truly stop "the agent."
- If the GUI mint is **gated on the human/turnstile check** (which the gate already has), a headless
  agent cannot mint via GUI; the only machine path left is the **MCP key** — which is the auditable,
  revocable, owner-provisioned door by design ([[owner-can-be-the-bot]], [[owner-mcp-driving-path]]).
  This is what actually makes "不能随便弄" true.

**Recommendation:** gate the GUI mint on the human check; leave the MCP key as the sanctioned machine
door. Then: human at a browser → JWT; owner-provisioned signed key → JWT; a naked script → neither → 401.

## Test matrix (test-first)
- no JWT on an owner endpoint → 401 + the "use MCP or GUI" guidance (assert the message, not just the code).
- valid GUI-minted JWT → passes.
- valid MCP-minted JWT (after SigV1) → passes.
- expired JWT → 401. forged JWT (wrong salt) → 401. cross-instance JWT (other instance's salt) → 401.
- visitor/public endpoints unaffected (no JWT required).
- SigV1 / session still independently required (additive, not replacement): a valid JWT alone without
  SigV1/session does NOT authorize.

## Scope note
Owner-side only. This is not visitor auth. It is a second lock on the owner's own door so the product
itself enforces "come through the front" instead of relying on the agent's manners or a harness gate.
