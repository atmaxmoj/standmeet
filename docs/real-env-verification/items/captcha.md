# captcha — Real Turnstile captcha

- **Module:** The real captcha provider's verification endpoint is actually called, and the backend classifies a fresh token, a replayed one and a forged one differently. A solved token lifts the per-IP lockouts on the gate, on request-access and on login.
- **Surface:** `/gate` (code entry and request-access) and `/login`.
- **Real dep:** The provider's published test keys — one that always passes, one that always fails, one that reports a spent token. The verification URL is hardcoded, so real keys are the only way to exercise it. Captcha is off by default (see [[deploy-forks]]), so this path must be opted into first, and turned back off after.
- **Backing e2e:** `security-captcha-bypass` · `security-code-bruteforce` · `security-login-guard` · `gate-request-access` · `gate-code-ux`. A positive real-verification path → `gap`.

## Checks

### 1 — A fresh token verifies against the real provider ⭐
- **Steps:** Turn captcha on with the passing test key. Solve the widget. Submit. Watch the backend call the provider's verification endpoint with the caller's IP.
- **Expected:** The call goes to the real endpoint, the verdict comes back as a success, and the submission unlocks.
- **Mock gap:** Dev and CI wire a verifier that returns success unconditionally. It never contacts the provider, never sees a failure, never distinguishes a fresh token from a spent one, and never parses the error codes.
- **Backing test:** `gap`

### 2 — A replayed token is rejected
- **Steps:** Switch to the secret that reports a spent token. Re-submit a token that already verified.
- **Expected:** The provider reports it as duplicate or timed out, and the backend refuses. Single use is enforced by the provider, not assumed.
- **Backing test:** `gap`

### 3 — A forged token is rejected
- **Steps:** Submit junk in place of a token.
- **Expected:** The provider reports an invalid response and the backend refuses. The owner-facing copy is a sentence, not the provider's raw error array.
- **Backing test:** `security-captcha-bypass.spec.ts` (hard-lock while captcha is off)

### 4 — A solved token lifts each lockout
- **Steps:** Trip the per-IP lockout with wrong access codes. Solve the widget and retry with a valid code. Repeat for the login guard with wrong passwords, and for the request-access form.
- **Expected:** Each surface demands a captcha once locked, and a solved token is both required and sufficient to lift it. The lock is per IP.
- **Backing test:** `security-code-bruteforce.spec.ts` · `security-login-guard.spec.ts` · `gate-request-access.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

With captcha enabled the widget renders with the site key and can actually be solved.
A failed verification shows friendly copy, never the provider's raw error codes.
With captcha disabled no widget appears anywhere, and the IP lockout still guards on its own.

## Note — who can drive this

Checks 1, 2 and 4 all begin "solve the widget", and an assistant does not solve captchas or other
bot checks. That holds even on the owner's own instance: the restriction is on the act, not on who
owns the target, so it is not something a standing instruction relaxes.

So these three checks need a human at the keyboard for one step. Everything either side of that
step is drivable: turning captcha on with the test key, watching the backend call the provider,
reading the verdict, and check 3 in full (a forged token is junk, not a solved widget).

The same limit applies to first-run setup, which ends on an arithmetic human-check before
`CLAIM INSTANCE` — so **re-claiming a wiped instance is not something the assistant can finish
alone**. Worth knowing before wiping one.
