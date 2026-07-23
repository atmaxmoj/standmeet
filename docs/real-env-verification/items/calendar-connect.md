# calendar-connect — Booking: OAuth connect + token lifecycle

- **Status:** ✅ verified (2026-07-23) — full real Google OAuth2 dance completed on prod: saved client_id/secret → Authorize → consent (calendar.events + calendar.readonly) → callback → token exchange → connector connected:true, active:true. Cleared `access_denied` by self-adding the test user in the Google Cloud console (consent screen was Testing with 0 test users — a real first-run friction: an unverified/testing app needs the account added as a test user before OAuth works). UX-11 tz default holds. Refresh/rotate/invalid_grant not separately forced this round.
- **Module:** connect a calendar via a real OAuth2 dance (consent → code+secret+PKCE+state → token), refresh transparently on expiry, rotate + persist the new refresh token, and surface `invalid_grant` as a friendly reconnect.
- **Surface:** admin/connectors (Google Calendar card).
- **Real dep:** real `accounts.google.com` OAuth (`GOOGLE_OAUTH_CLIENT_ID/SECRET`) or any real OAuth2 AS. After the connector exists, register its generated `redirect_uri` back on the OAuth client.
- **Inherits (historical finding IDs):** `F-B-2` (Authorize → `/init` 404, OAuth dance dead).
- **Backing e2e:** `connector-happy-matrix` (mock OAuth dance) · `chat-book-token-refresh` · `security-oauth-callback-state` · `connector-err-refresh-network`.

## Checks

### 1 — OAuth connect (real consent, real token)  (was §B1)
- **Steps:** admin/connectors → connect Google → browser redirects to real Google consent → authorize → callback exchanges a real refresh/access token; connector flips to connected.
- **Expected:** connected; the DB stores real (encrypted) tokens, not mock tokens.
- **Backing test:** `connector-happy-matrix.spec.ts` (mock OAuth dance)
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — connect leg needs a real Google OAuth consent (panel + booking-policy present + UX-11 tz fix verified). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 2 — Real OAuth2 dance (code + secret + PKCE + state)  (was §H2)
- **Steps:** build an OAuth2 connector against a real authorization server → connect → real consent → callback exchanges `code` + `client_secret` (with PKCE + real `redirect_uri`, real `state`).
- **Expected:** a real token is minted; `state` is validated; the refresh token rotates and the new one persists.
- **⚠️ mock gap:** the mock **validates no `client_secret` / `code` / PKCE / `redirect_uri` and never rotates the refresh token** (`gcal.go:172`) → the real exchange + rotation persistence is untested.
- **Backing test:** `connector-happy-matrix.spec.ts` (openapi calendar + oauth2 dance) · `security-oauth-callback-state.spec.ts` (forged state never mints a token / no open-redirect)
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — connect leg needs a real Google OAuth consent (panel + booking-policy present + UX-11 tz fix verified). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 3 — Token refresh + rotation  (was §B7)
- **Steps:** force the access token to expire → the next call should refresh transparently; revoke it → should give a friendly `revoked` error.
- **⚠️ mock gap:** the mock never rotates the refresh token; the persist-new-refresh-token path is untested.
- **Backing test:** `chat-book-token-refresh.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — connect leg needs a real Google OAuth consent (panel + booking-policy present + UX-11 tz fix verified). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 4 — OAuth silent refresh + `invalid_grant` (partial)  (was §P2)
- **Steps:** on a **real** OAuth provider force token expiry/skew → next call should refresh transparently; revoke the grant → the refresh returns `invalid_grant` and surfaces as a friendly "reconnect required".
- **Expected:** transparent refresh on expiry; `invalid_grant` → friendly reconnect prompt, no crash, no retry storm (an `invalid_grant` must **not** be retried).
- **⚠️ partial:** needs a real provider — the mock validates no client_secret/code/PKCE/redirect_uri and never rotates the refresh token, so the real `invalid_grant` path can't be reproduced without live Google. The reproducible half (no-retry-on-invalid_grant) can be tested; the real-provider half stays `manual-only`.
- **Backing test:** `connector-retry-invalid-grant-no-retry.spec.ts` · `connector-err-refresh-network.spec.ts` · `connector-gcal-rotate-creds-reverify.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — connect leg needs a real Google OAuth consent (panel + booking-policy present + UX-11 tz fix verified). Backing e2e green; not manually driven (no live disproof, no manual proof).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The connector card shows its **true** state (connected / disconnected / error), not a stale default; Authorize actually navigates to consent (not a dead `/init`); a revoked grant shows a friendly reconnect prompt.

## Findings
(record here; also log `../findings.md`, ID `F-B-n` / `F-P-n` historical anchor)

- **F-B-2** (first pass): Authorize → `/init` 404 — creds save ✓ but the OAuth dance was dead. Redirect URI registered in Google.
