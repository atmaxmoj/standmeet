# captcha — Real Turnstile captcha

- **Status:** 🟡 blocked-by-config — Turnstile OFF by default (no widget on /gate); real-siteverify needs CF test keys; e2e covers off-state hard-lock
- **Module:** the real Cloudflare Turnstile siteverify is actually called and correctly classifies success / replayed-consumed / forged tokens, and a solved token lifts the per-IP lockouts on gate / request-access / login.
- **Surface:** `/gate` (code-guard + request-access) + `/login`.
- **Real dep:** Cloudflare's published test keys (`TURNSTILE_SITEKEY_*` / `TURNSTILE_SECRET_*` PASS/FAIL/SPENT). The siteverify URL is hardcoded (`turnstile.go:28`), so real keys are the only way to exercise it. Captcha is off by default in prod (see [[deploy-forks]]) — this is the opt-in path.
- **Backing e2e:** `security-captcha-bypass` · `security-code-bruteforce` · `security-login-guard` · `gate-request-access` · `gate-code-ux`.

## Checks

### 1 — siteverify actually called; replay/consumed + forged tokens rejected ⭐  (was §G1)
- **Steps:** (a) solve the widget → submit → backend POSTs the token to real siteverify with `remoteip` → unlock succeeds. (b) **Replay:** re-submit an already-verified token using `TURNSTILE_SECRET_SPENT` → real Cloudflare returns `timeout-or-duplicate`. (c) **Forged:** submit junk → `invalid-input-response`. Confirm the backend maps each real `error-codes` array to the right outcome (unlock only on `success:true`).
- **Expected:** a valid token unlocks; a replayed/consumed token is rejected (single-use enforced by Cloudflare); a forged token is rejected; the real `error-codes` shape + `remoteip` round-trip.
- **⚠️ mock gap:** dev/e2e run the noop verifier (`captcha.go:58/71`) returning nil unconditionally — never contacts siteverify, never sees `success:false`, never distinguishes fresh from spent, never parses `error-codes`.
- **Backing test:** `security-captcha-bypass.spec.ts:34` (bogus token doesn't unlock while captcha off — the hard-lock, not the real verify) — no positive real-siteverify spec (gap)
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — Turnstile OFF by default on this fork (no widget); real siteverify needs CF test keys. Backing e2e green; not manually driven (no live disproof, no manual proof).
### 2 — code-guard on `/gate`  (was §G2)
- **Steps:** trip the per-IP access-code lockout with wrong codes → the gate demands a captcha → solve the real widget → the lock lifts and the valid code redeems.
- **Expected:** after N wrong codes the IP is locked (429); a real solved token is required and sufficient to lift it; the lock is per-IP.
- **Backing test:** `security-code-bruteforce.spec.ts:40` · `security-captcha-bypass.spec.ts:34` · `gate-code-ux.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — Turnstile OFF by default on this fork (no widget); real siteverify needs CF test keys. Backing e2e green; not manually driven (no live disproof, no manual proof).
### 3 — access-request captcha  (was §G3)
- **Steps:** on the gate's request-access form, submit with a real solved token → accepted; forged/blank → rejected.
- **Expected:** the request-access form verifies the token against real siteverify before recording.
- **Backing test:** `gate-request-access.spec.ts:40`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — Turnstile OFF by default on this fork (no widget); real siteverify needs CF test keys. Backing e2e green; not manually driven (no live disproof, no manual proof).
### 4 — login Turnstile  (was §G4)
- **Steps:** trip the login brute-force lockout → login demands a captcha → solve the real widget → the lock lifts and a correct password logs in.
- **Expected:** the login guard's captcha gate verifies against real siteverify; a solved token lifts the per-IP rate-limit.
- **Backing test:** `security-login-guard.spec.ts:25` (rate-limit trips 429/503 — the captcha-lift leg still open)
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — Turnstile OFF by default on this fork (no widget); real siteverify needs CF test keys. Backing e2e green; not manually driven (no live disproof, no manual proof).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
When enabled, the widget **renders** with the site key and is solvable; a failed verify shows friendly copy, not a raw `error-codes` array.

## Findings
(record here; also log `../findings.md`, ID `F-G-n` historical anchor)

- **✅ PASS (2nd pass):** enabled Turnstile (Cloudflare dummy test keys) on prod: `captcha_site_key` exposed; login hits the **real** `challenges.cloudflare.com/siteverify`. Verdict flips with the secret. Reverted to off.
