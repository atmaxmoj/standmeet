# connector-security — Connectors: secret at-rest + SSRF + rotation

- **Status:** ⬜ not started (new round)
- **Module:** connector credentials are encrypted + AAD-bound and never leak (transcript/logs/status); the runtime dialer blocks SSRF (DNS-rebind to private IPs) live; an `INSTANCE_SECRET` rotation degrades to a friendly reconnect, not a decrypt panic.
- **Surface:** admin/connectors (secret masking) + backend runtime dialer.
- **Real dep:** prod stack with `CONNECTOR_EGRESS_ALLOW` empty (so the SSRF guard is live) + a hostname you control that can flip DNS to a private IP; for rotation, a DB of encrypted creds + an `INSTANCE_SECRET` change.
- **Backing e2e:** `connector-secret-no-leak` · `connector-security` · Go unit `backend/internal/connector/egress_test.go` · `connector-secret-no-leak` (nearest at-rest).

## Checks

### 1 — Credential at-rest (AAD-bound, never in transcript/logs)  (was §H4)
- **Steps:** inspect the stored connector credential → confirm it is encrypted + AAD-bound; grep the transcript and logs for the raw secret.
- **Expected:** the raw secret is never returned on any surface and is masked in status/list; it never appears in a transcript or a log line.
- **Backing test:** `connector-secret-no-leak.spec.ts` · `connector-security.spec.ts`
- **Result:** ⬜
### 2 — SSRF BLOCK path (never runs in CI) ⭐  (was §H5)
- **Steps:** build a connector whose `servers[].url` (or OAuth token URL) resolves **public first, then flips to a private IP** — DNS-rebind to `169.254.x` / `127.x` / an IPv6-private address — and one whose redirect lands on a private IP mid-call.
- **Expected (likely RED at e2e):** the runtime dialer refuses with `ErrBlockedEgress`; assembly is refused for a statically-internal URL.
- **⚠️ mock gap:** `CONNECTOR_EGRESS_ALLOW=external-mock` **whitelists the mock host**, so `safeDialAddr` (`egress.go:104`, whitelist short-circuit `:109`) **never actually blocks** in CI — the DNS-rebind block branch (`resolveSafeIP`, `egress.go:145-149`) is only ever exercised by a Go unit test, **never by an e2e against a real rebinding host**. The whole SSRF thesis, unwalked live.
- **Backing test:** `connector-security.spec.ts` (`ssrfConsumeTimeRejected` / `ssrfOAuthDanceRedirectRejected` — both hit `external-mock`, not a real rebinding host) · Go unit `egress_test.go`
- **Result:** ⬜
### 3 — Envelope decrypt + `INSTANCE_SECRET` rotation (partial)  (was §P3)
- **Steps:** with a DB holding real encrypted connector creds, rotate `INSTANCE_SECRET` → attempt to use a connector → observe.
- **Expected:** a friendly "reconnect required" (AAD mismatch handled), **not** a decrypt panic.
- **⚠️ partial:** needs a populated encrypted-creds DB + a rotation event — not driven by any current spec (gap). Reproducible in a harness (encrypt under key A, boot under key B, assert friendly error).
- **Backing test:** no dedicated spec (gap); `connector-secret-no-leak.spec.ts` is the nearest cred-at-rest coverage.
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Every connector surface (status / list / edit) shows the secret **masked** — never a raw key; a blocked-egress or rotation error reads friendly.

## Findings
(record here; also log `../findings.md`, ID `F-H-n` / `F-P-n` historical anchor)
