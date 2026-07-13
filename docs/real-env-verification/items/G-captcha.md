# §G — Real Turnstile captcha

- **Status:** ⬜ not-run
- **Scope:** runnable-now · public test keys
- **Prereqs/creds:** `verify-creds.env` → `TURNSTILE_SITEKEY_PASS` / `TURNSTILE_SECRET_PASS` (Cloudflare's always-pass test pair), `TURNSTILE_SITEKEY_FAIL` / `TURNSTILE_SECRET_FAIL` (always-fail/-block), and `TURNSTILE_SECRET_SPENT` (the "token already spent" test secret). These are Cloudflare's published test keys — no account or real widget challenge needed.
- **Real service:** real Cloudflare `challenges.cloudflare.com/turnstile/v0/siteverify`, replacing the dev/e2e **noop verifier** (`backend/internal/captcha/captcha.go:58`, `noopVerifier.Verify` always returns nil — `captcha.go:71`). Note the real siteverify URL is **hardcoded, not env-overridable** (`backend/internal/captcha/turnstile.go:28`), so the only way to exercise it is with real Turnstile keys set.
- **Backing e2e:** (attribution targets) `security-captcha-bypass` · `security-code-bruteforce` · `security-login-guard` · `gate-request-access` · `gate-code-ux`

> One-time setup: on the prod stack, set `TURNSTILE_SITEKEY_*` + `TURNSTILE_SECRET_*` so `NewFromConfig` selects the **turnstile** verifier (both key and secret non-empty; either empty → `ProviderNone`, `captcha.go:65`). The frontend widget renders with the site key; the backend verifies the widget token against the matching secret. Captcha is off by default in prod (see §N4) — this item is the opt-in path.

## Sub-items

### G1 — siteverify actually called; replay/consumed + forged tokens rejected ⭐
- **Steps:** (a) solve the widget (pass sitekey) → submit → backend POSTs the token to real siteverify with `remoteip` → unlock succeeds. (b) **Replay:** take a token that already verified once and re-submit it using `TURNSTILE_SECRET_SPENT` → real Cloudflare returns `timeout-or-duplicate` (single-use). (c) **Forged:** submit a hand-made junk token → real siteverify returns a `invalid-input-response` error-codes shape. Confirm the backend maps each real `error-codes` array to the right outcome (unlock only on `success:true`).
- **Expected:** a valid widget token unlocks; a **replayed/consumed** token is rejected (single-use enforced by Cloudflare, not the backend); a forged token is rejected; the real `error-codes` shape + `remoteip` round-trip correctly.
- **⚠️ mock gap:** dev/e2e run the noop verifier (`captcha.go:58/71`), which returns nil unconditionally — it never contacts siteverify, never sees `success:false`, never distinguishes a fresh token from a spent one, and never parses an `error-codes` array. The single-use / forged / error-classification behavior has **zero deterministic backing**; the only positive-path assertion CI can make is "noop always passes." **High-value Finding candidate** (use `TURNSTILE_SECRET_SPENT` for the replay leg).
- **Backing test:** `security-captcha-bypass.spec.ts:34` (asserts a *bogus* token does NOT unlock while captcha is off — i.e. the hard-lock, not the real verify) — no positive real-siteverify spec (gap)
- **Result:** ⬜

### G2 — code-guard on `/gate`
- **Steps:** trip the per-IP access-code lockout with wrong codes → the gate demands a captcha → solve the real widget → the lock lifts and the valid code redeems.
- **Expected:** after N wrong codes the IP is locked (429); a real solved Turnstile token is required and sufficient to lift it; the lock is per-IP (a clean IP with the valid code is unaffected).
- **Backing test:** `security-code-bruteforce.spec.ts:40` · `security-captcha-bypass.spec.ts:34` · `gate-code-ux.spec.ts`
- **Result:** ⬜

### G3 — access-request captcha
- **Steps:** on the gate's request-access form, submit with a real solved widget token → the request is accepted; submit with a forged/blank token → rejected.
- **Expected:** the request-access form actually verifies the token against real siteverify before recording the request.
- **Backing test:** `gate-request-access.spec.ts:40`
- **Result:** ⬜

### G4 — login Turnstile
- **Steps:** trip the login brute-force lockout (hammer wrong passwords from one IP) → login demands a captcha → solve the real widget → the lock lifts and a correct password logs in.
- **Expected:** the login guard's captcha gate verifies against real siteverify; a solved token lifts the per-IP rate-limit.
- **Backing test:** `security-login-guard.spec.ts:25` (rate-limit trips at 429/503 — the captcha-lift leg is still `[ ]` per inventory §G)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-G-n`)
