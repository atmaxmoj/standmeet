# §H — Real connector (OpenAPI / protocol / OAuth / SSRF / CalDAV)

- **Status:** ⬜ not-run
- **Scope:** Cal.com ✅ · CalDAV 🟡Radicale · OAuth/SSRF runnable
- **Prereqs/creds:** `verify-creds.env` → `CALCOM_API_KEY`, `CALCOM_API_V1`, `CALCOM_API_V2` (a real Cal.com account; the OpenAPI spec is published at `api.cal.com/v2/docs`). CalDAV is verified against a **self-run Radicale server** (the guide allows Radicale — no paid CalDAV account needed). A real OAuth2 authorization server for H2 (reuse §B's Google OAuth app, or any real OAuth2 app). For H5, a hostname you control whose DNS/redirect you can flip to a private IP.
- **Real service:** real Cal.com OpenAPI + `api.cal.com/v2`, a real OAuth2 authorization server, a self-run Radicale CalDAV server, and real DNS/redirect for the SSRF path — replacing `external-mock`'s scripted `gcal` / generic-oauth / `caldav`.
- **Backing e2e:** (attribution targets) `connector-happy-matrix` · `connector-spec-ingest` · `connector-assemble-from-ui` · `connector-openapi-mail` · `connector-security` · `security-oauth-callback-state` · `connector-secret-no-leak`

> One-time setup: on the prod stack claim owner → admin/connectors → upload the Cal.com OpenAPI spec, bind list-slots/book operations → connect with `CALCOM_API_KEY` → get the connector id. Bring up a local Radicale for H6. Point `CONNECTOR_EGRESS_ALLOW` at **nothing** (prod default) so the SSRF guard is actually live for H5.

## Sub-items

### H1 — Upload a real vendor OpenAPI (Cal.com) + binding
- **Steps:** admin/connectors → upload the Cal.com OpenAPI spec (`api.cal.com/v2/docs`) → candidate operations surface → bind list-slots / book via JSONata → assemble the connector.
- **Expected:** the real spec parses, real candidate operations surface, the binding assembles, and the booker calls the real `api.cal.com/v2`.
- **⚠️ mock gap:** CI only ever assembles **hand-written** specs against `external-mock`; a real vendor spec (large, `$ref`-heavy, real auth blocks) has never been ingested.
- **Backing test:** `connector-spec-ingest.spec.ts` · `connector-assemble-from-ui.spec.ts` · `connector-happy-matrix.spec.ts`
- **Result:** ⬜

### H2 — Real OAuth2 dance
- **Steps:** build an OAuth2 connector against a real authorization server → connect → real consent → callback exchanges `code` + `client_secret` (with PKCE + real `redirect_uri`, real `state`).
- **Expected:** a real token is minted; `state` is validated; the refresh token rotates and the new one persists.
- **⚠️ mock gap:** the mock **validates no `client_secret` / `code` / PKCE / `redirect_uri` and never rotates the refresh token** (`gcal.go:172`) → the real exchange + rotation persistence is untested.
- **Backing test:** `connector-happy-matrix.spec.ts` (openapi calendar + oauth2 dance) · `security-oauth-callback-state.spec.ts` (forged state never mints a token / no open-redirect)
- **Result:** ⬜

### H3 — Real proxied call (Cal.com book via api key)
- **Steps:** connect Cal.com with `CALCOM_API_KEY` → booker lists real slots + books through the real `api.cal.com/v2`.
- **Expected:** a real slot list, then a real booking that **actually appears on the Cal.com dashboard**.
- **Backing test:** `connector-happy-matrix.spec.ts` (openapi calendar + apiKey: assemble → apiKey form → booker books) · `connector-openapi-mail.spec.ts`
- **Result:** ⬜

### H4 — Credential at-rest (AAD-bound, never in transcript/logs)
- **Steps:** inspect the stored connector credential → confirm it is encrypted + AAD-bound; grep the transcript and logs for the raw secret.
- **Expected:** the raw secret is never returned on any surface and is masked in status/list; it never appears in a transcript or a log line.
- **Backing test:** `connector-secret-no-leak.spec.ts` · `connector-security.spec.ts` (no credential leak · masked in status/list)
- **Result:** ⬜

### H5 — SSRF BLOCK path (never runs in CI) ⭐
- **Steps:** build a connector whose `servers[].url` (or OAuth token URL) resolves **public first, then flips to a private IP** — DNS-rebind to `169.254.x` / `127.x` / an IPv6-private address — and one whose redirect lands on a private IP mid-call.
- **Expected (likely RED at e2e):** the runtime dialer refuses with `ErrBlockedEgress`; assembly is refused for a statically-internal URL.
- **⚠️ mock gap:** `CONNECTOR_EGRESS_ALLOW=external-mock` **whitelists the mock host**, so `safeDialAddr` (`egress.go:104`, whitelist short-circuit at `egress.go:109`) **never actually blocks** in CI — the DNS-rebind block branch (`resolveSafeIP`, `egress.go:145-149`) is only ever exercised by a Go unit test (`egress_test.go` `TestSafeDialAddr_RebindInternalBlocked`), **never by an e2e against a real rebinding host**. This is the whole SSRF thesis, unwalked live. **High-value Finding candidate.**
- **Backing test:** `connector-security.spec.ts` (`ssrfConsumeTimeRejected` / `ssrfOAuthDanceRedirectRejected` — but both hit `external-mock`, not a real rebinding host) · Go unit `backend/internal/connector/egress_test.go`
- **Result:** ⬜

### H6 — Real CalDAV connector (Radicale, recurring event)
- **Steps:** point a CalDAV connector at the self-run Radicale (with auth) → booker lists slots + books, and drive a **recurring** event (RRULE + VTIMEZONE).
- **Expected:** real auth is enforced; REPORT filters are honored; RRULE / VTIMEZONE expand correctly (booking lands on the right expanded occurrence).
- **⚠️ mock gap:** the mock has **no auth, ignores REPORT filters, no RRULE/VTIMEZONE expansion, always-207 PROPFIND** (`caldav.go:63`) → recurrence expansion + auth + filter behavior are all untested.
- **Backing test:** `connector-happy-matrix.spec.ts` (protocol calendar (CalDAV): pick built-in card → fixed form → booker books)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-H-n`)
