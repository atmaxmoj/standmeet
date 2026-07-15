# mail-connector — Mail: real send across SMTP + SaaS

- **Status:** ⬜ not-run
- **Module:** the mail connector actually delivers — access-code emails, recovery phrases, test-sends — over a real STARTTLS+AUTH SMTP relay AND a real SaaS (SendGrid) path, classifying real reply codes correctly and failing friendly.
- **Surface:** admin/connectors (mail connector) + admin/requests (approve → email) + `/gate` (request-access).
- **Real dep:** real Gmail SMTP (`smtp.gmail.com:587`, STARTTLS + AUTH, app-password) + a real readable inbox; optionally a SendGrid API key + verified sender.
- **Inherits (historical finding IDs):** `F-C-1`, `F-C-2` (protocol credential-form — both ✅ fixed; real send verified).
- **Backing e2e:** `mail-connector` · `admin-requests` · `gate-request-access` · `recovery-phrase` · `password-reset` · `connector-protocol-smtp` · `connector-openapi-mail` · `connector-err-smtp-fail` · `connector-mail-rotate-creds-reverify`.

> A verified mail connector un-gates `mail.send`, the access-request approve button, and the gate's request-access block. For SMTP pick **protocol SMTP** (6 fixed fields, Gmail relay); for SaaS assemble an **openapi mail** connector (SendGrid-style, apiKey, no OAuth).

## Checks

### 1 — Access-request approve → real code email lands → code works  (was §C1)
- **Steps:** visitor hits `/gate` → submits request-access with the inbox address → admin/requests approves → backend emails the `LABEL-XXX` access code through real Gmail SMTP → open the inbox, read the code → redeem it → a session opens.
- **Expected:** the email actually arrives in the real inbox (not a mailpit catcher), the code redeems, and a coded session starts.
- **Backing test:** `mail-connector.spec.ts:29` · `admin-requests.spec.ts` · `gate-request-access.spec.ts:40`
- **Result:** ⬜

### 2 — Recovery-phrase email  (was §C2)
- **Steps:** admin generates a recovery phrase → backend emails it to the owner address → read it → use `/recover` to sign a locked-out owner back in → confirm single-use.
- **Expected:** the phrase email lands in the real inbox; recovery logs in; the phrase is single-use.
- **Backing test:** `recovery-phrase.spec.ts:66` · `password-reset.spec.ts`
- **Result:** ⬜

### 3 — `connectors.mail_test_send`  (was §C4)
- **Steps:** from admin/connectors run the mail connector's test-send against the real relay → confirm the probe email lands. Rotate the credential and re-verify the send still works.
- **Expected:** the test-send actually delivers; re-verify after a credential rotation still delivers.
- **Backing test:** `mail-connector.spec.ts` · `connector-mail-rotate-creds-reverify.spec.ts`
- **Result:** ⬜

### 4 — Real SMTP (STARTTLS+AUTH) AND real SaaS path ⭐  (was §C5)
- **Steps:** (a) drive checks 1/booking-email through the **protocol-SMTP** connector against `smtp.gmail.com:587` — real relay advertises `STARTTLS`+`AUTH` and demands both; complete a real STARTTLS upgrade + app-password AUTH; then provoke real reply codes (bad recipient → `550`, oversized → `552`, throttled → `4xx` greylist) and confirm each maps to a friendly outcome. (b) Repeat through a real **SendGrid** `/mail/send` — expect `202`, a message id from the **`X-Message-Id` header**, a verified sender.
- **Expected:** real STARTTLS+AUTH handshake succeeds; each real reply code is classified correctly (not all collapsed to "sent OK"); SendGrid returns `202` with a header message-id.
- **⚠️ mock gap:** the SMTP mock advertises a bare single-line `250 mail-mock` on EHLO — **no `STARTTLS`, no `AUTH`** (`mock-stack/mail/smtp.go:54`) — and every command answers `250 OK`, so the real reply-code / error-classification path is never exercised. The SendGrid mock puts the id in the **body** not the `X-Message-Id` header and checks no API key.
- **Backing test:** `connector-protocol-smtp.spec.ts:63` · `connector-openapi-mail.spec.ts:376` · `connector-err-smtp-fail.spec.ts:36`
- **Result:** ⬜

### 5 — Real SMTP / SaaS auth failure → friendly, no crash  (was §C6)
- **Steps:** configure a wrong app-password (or a not-verified SendGrid sender) → attempt a send → observe the surfaced error.
- **Expected:** a human-readable failure (bad-auth / not-verified), no stack trace, no exit code; a booking is kept, not rolled back, when only the confirmation send fails.
- **Backing test:** `connector-err-smtp-fail.spec.ts:36` · `connector-protocol-smtp.spec.ts:99`
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The mail connector card shows connected/verified truthfully; admin/requests **list shows pending requests** (and the count badge matches the list); the approve button is enabled only with a verified connector.

## Findings
(record here; also log `../findings.md`, ID `F-C-n` historical anchor)

- **✅ now works** (first pass): F-C-1 ✅fixed, F-C-2 ✅fixed (protocol credential-form). Verified real send: Gmail app-pw via generic `/connectors/smtp/*` → connect (real handshake) → activate → `/mail/test-send` → `{ok:true}`, a real email out.
