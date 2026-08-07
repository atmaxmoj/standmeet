# calendar-connect — Booking: OAuth connect + token lifecycle

- **Module:** A calendar connects through a real OAuth dance — consent, then an exchange carrying the code, the secret, PKCE and state. Tokens refresh transparently on expiry, a rotated refresh token persists, and a revoked grant surfaces as a friendly reconnect.
- **Surface:** `/admin/connectors`, the calendar card.
- **Real dep:** A real OAuth authorization server and a real account. After the connector exists, its generated redirect URI must be registered back on the OAuth client. An app still in testing needs the account added as a test user first, or consent is denied — that is real first-run friction, not a defect.
- **Backing e2e:** `connector-happy-matrix` (mock dance) · `chat-book-token-refresh` · `security-oauth-callback-state` · `connector-err-refresh-network` · `connector-retry-invalid-grant-no-retry` · `connector-gcal-rotate-creds-reverify`.

## Checks

### 1 — Authorize reaches real consent and comes back with a real token ⭐
- **Steps:** Save the client credentials on the card. Click Authorize. Complete consent on the provider. Return through the callback. Read the connector's state and the stored credential.
- **Expected:** The browser reaches the provider's own consent screen. The callback exchanges a real token. The card shows connected and active. The stored token is real and encrypted, not a mock value.
- **Backing test:** `connector-happy-matrix.spec.ts` (mock dance) · the real dance → `gap`

### 2 — The exchange is validated, and the refresh token rotates
- **Steps:** Complete the dance against a real authorization server. Inspect what the exchange sent and what came back. Force a refresh. Read the stored refresh token before and after.
- **Expected:** The exchange carries the secret, the PKCE verifier and the real redirect URI, and the state is validated on return. A rotated refresh token replaces the stored one.
- **Mock gap:** The mock validates no secret, no code, no PKCE and no redirect URI, and never rotates the refresh token. So the real exchange and rotation persistence are unexercised.
- **Backing test:** `security-oauth-callback-state.spec.ts` · rotation against a real server → `gap`

### 3 — An expired token refreshes without the owner noticing
- **Steps:** Force expiry or clock skew on a real provider. Make a call that needs the calendar.
- **Expected:** The call succeeds after a transparent refresh. The owner sees nothing.
- **Backing test:** `chat-book-token-refresh.spec.ts`

### 4 — A revoked grant asks for a reconnect, once
- **Steps:** Revoke the grant at the provider. Make a call. Watch the logs for retries.
- **Expected:** The refusal surfaces as a friendly reconnect prompt. There is no crash and no retry storm — a revoked grant must not be retried.
- **Mock gap:** The real revocation path needs a live provider. The no-retry half is reproducible without one.
- **Backing test:** `connector-retry-invalid-grant-no-retry.spec.ts` · `connector-err-refresh-network.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The card shows its true state — connected, disconnected or error — never a stale default from before the last action.
Authorize actually navigates to consent; a button that goes nowhere is the failure this surface has had before.
A revoked grant reads as a reconnect prompt, not as a raw provider error code.
