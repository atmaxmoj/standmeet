# connector-security — Connectors: secret at-rest + SSRF + rotation

- **Module:** Connector credentials are encrypted and AAD-bound, and never leak on any surface. The runtime dialer blocks SSRF, including a host that resolves public and then flips to a private address. Rotating the instance secret degrades to a friendly reconnect, not a decrypt panic.
- **Surface:** `/admin/connectors` for masking, and the backend runtime dialer for egress.
- **Real dep:** A prod stack with the egress allow-list EMPTY, so the guard is live. A hostname you control that can flip DNS to a private IP. For rotation, a database holding encrypted credentials and a changed instance secret.
- **Backing e2e:** `connector-secret-no-leak` · `connector-security` · Go unit `egress_test.go`. Rotation → `gap`.

## Checks

### 1 — A stored credential is encrypted and bound
- **Steps:** Read the stored credential directly from the database. Read the connector's status and list responses. Grep a session transcript and the logs for the raw secret.
- **Expected:** The stored value is ciphertext bound to this owner. The raw secret appears on no surface, in no transcript, and in no log line. Status and list show it masked.
- **Backing test:** `connector-secret-no-leak.spec.ts` · `connector-security.spec.ts`

### 2 — The dialer blocks a host that flips to a private address ⭐
- **Steps:** Point a connector at a hostname you control that resolves public first and then to a private address. Call through it. Then try one whose redirect lands on a private address mid-call.
- **Expected:** The dialer refuses both with a blocked-egress error. Assembly is refused outright for a statically internal URL.
- **Mock gap:** CI whitelists the mock host, so the whitelist short-circuits before the guard ever runs. The rebind branch is exercised only by a Go unit test, never end to end against a real rebinding host. The SSRF thesis is unwalked live.
- **Backing test:** `connector-security.spec.ts` (hits the whitelisted mock) · `egress_test.go` (unit) · a real rebinding host → `gap`

### 3 — Rotating the instance secret asks for a reconnect
- **Steps:** Start from a database holding real encrypted credentials. Change the instance secret. Restart. Use a connector.
- **Expected:** The owner sees a message asking them to reconnect. The process does not panic and the surface does not show a decrypt error.
- **Mock gap:** No spec drives a rotation. It is reproducible in a harness: encrypt under one key, boot under another, assert the friendly error.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Every connector surface — status, list, edit — shows the secret masked, never a raw key.
A blocked egress and a rotation mismatch both reach the owner as sentences they can act on.
A connector that says it is connected can actually be called; a status that cannot be trusted is worse than none.
