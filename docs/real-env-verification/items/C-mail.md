# §C — Real mail

- **Status:** ⬜ not-run
- **Scope:** runnable-now · Gmail SMTP
- **Prereqs/creds:** `verify-creds.env` → `GMAIL_SMTP_HOST` / `GMAIL_SMTP_PORT` / `GMAIL_SMTP_USER` / `GMAIL_SMTP_APP_PASSWORD` (host `smtp.gmail.com:587`, STARTTLS + AUTH, app-password — a plain account password is refused). The **inbox is the same Gmail account**; read landed mail via the Gmail web UI or IMAP. Optional SaaS path (C5): a SendGrid API key + a verified sender.
- **Real service:** real Gmail SMTP relay (`smtp.gmail.com:587`, STARTTLS + AUTH) + a real readable inbox, replacing dev's `mail-mock` (SMTP fault-arming upstream) and `mailpit` (the test SMTP catcher). SaaS path replaces the `sendgrid` mock in `mock-stack/job-board/`.
- **Backing e2e:** (attribution targets) `mail-connector` · `admin-requests` · `gate-request-access` · `recovery-phrase` · `password-reset` · `booking-confirmation-email` · `connector-send-confirmation-tool` · `connector-protocol-smtp` · `connector-openapi-mail` · `connector-err-smtp-fail` · `connector-mail-rotate-creds-reverify`

> One-time setup: on the prod stack, claim owner → admin builds a mail connector. For the SMTP path pick **protocol SMTP** (6 fixed fields) and fill in the Gmail relay (`smtp.gmail.com` / `587` / STARTTLS / user / app-password). Connect → the connector runs its real connection test and flips to Connected. For the SaaS path assemble an **openapi mail** connector (SendGrid-style, apiKey, no OAuth dance). Only a verified mail connector un-gates `mail.send`, the access-request approve button, and the gate's request-access block.

## Sub-items

### C1 — Access-request approve → real code email lands → code works
- **Steps:** visitor hits `/gate` → submits request-access with the inbox address → admin/requests approves → backend emails the `LABEL-XXX` access code through real Gmail SMTP → open the inbox, read the code → redeem it on the page → a session opens.
- **Expected:** the email actually arrives in the real inbox (not just a mailpit catcher), the code inside redeems, and a coded session starts.
- **Backing test:** `mail-connector.spec.ts:29` ('approve a request → code emailed → code opens a session') · `admin-requests.spec.ts` · `gate-request-access.spec.ts:40`
- **Result:** ⬜

### C2 — Recovery-phrase email
- **Steps:** admin generates a recovery phrase → backend emails it to the owner address → read it in the inbox → use `/recover` to sign a locked-out owner back in → confirm single-use (a second attempt with the same phrase is rejected).
- **Expected:** the phrase email lands in the real inbox; recovery logs in; the phrase is single-use.
- **Backing test:** `recovery-phrase.spec.ts:66` · `password-reset.spec.ts`
- **Result:** ⬜

### C3 — Booking confirmation email
- **Steps:** book through chat with confirmation → `send_confirmation` mails the HTML + schema.org confirmation to the session/profile email through real Gmail SMTP → confirm receipt and that the HTML renders in a real client.
- **Expected:** a well-formed confirmation email arrives; schema.org markup intact; nothing sent when the visitor declines.
- **Backing test:** `booking-confirmation-email.spec.ts:49` · `connector-send-confirmation-tool.spec.ts:46`
- **Result:** ⬜

### C4 — `connectors.mail_test_send`
- **Steps:** from admin/connectors run the mail connector's test-send against the real relay → confirm the probe email lands. Rotate the credential (`connector-mail-rotate-creds-reverify` path) and re-verify the send still works.
- **Expected:** the test-send actually delivers; re-verify after a credential rotation still delivers.
- **Backing test:** `mail-connector.spec.ts` · `connector-mail-rotate-creds-reverify.spec.ts`
- **Result:** ⬜

### C5 — Real SMTP (STARTTLS+AUTH) path AND real SaaS path ⭐
- **Steps:** (a) drive C1/C3 through the **protocol-SMTP** connector against `smtp.gmail.com:587` — the real relay advertises `STARTTLS` and `AUTH` in its EHLO banner and demands both; complete a real STARTTLS upgrade + app-password AUTH; then provoke real reply codes (a bad recipient → `550`, an oversized message → `552`, a throttled send → `4xx` greylist) and confirm the backend's error-classification maps each to a friendly outcome. (b) Repeat the send through a real **SendGrid** `/mail/send` — expect `202`, a message id read from the **`X-Message-Id` response header**, and a verified sender.
- **Expected:** real STARTTLS+AUTH handshake succeeds; each real reply code is classified correctly (not all collapsed to "sent OK"); SendGrid returns `202` with a header message-id.
- **⚠️ mock gap:** the SMTP mock advertises a bare single-line `250 mail-mock` on EHLO — **no `STARTTLS`, no `AUTH`** (`mock-stack/mail/smtp.go:54`) — and every command answers `250 OK` (`mock-stack/mail/smtp.go:57`+), so the real `4xx` greylist / `550` / `552` reply codes and the whole error-classification path are never exercised. The SendGrid mock puts the id in the **body** (`{"message_id": …}`, `mock-stack/job-board/sendgrid.go:178`) not the `X-Message-Id` header, and checks no API key — the real header-parse + auth path is untested. **High-value Finding candidate.**
- **Backing test:** `connector-protocol-smtp.spec.ts:63` (SMTP happy) · `connector-openapi-mail.spec.ts:376` (SaaS happy) · `connector-err-smtp-fail.spec.ts:36`
- **Result:** ⬜

### C6 — Real SMTP / SaaS auth failure → friendly, no crash
- **Steps:** configure a wrong app-password (or a not-verified SendGrid sender) → attempt a send → observe the surfaced error.
- **Expected:** a human-readable failure (bad-auth / not-verified), no stack trace, no exit code; a booking is kept, not rolled back, when only the confirmation send fails.
- **Backing test:** `connector-err-smtp-fail.spec.ts:36` · `connector-protocol-smtp.spec.ts:99` (bad SMTP auth → not connected)
- **Result:** ⬜

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-C-n`)
