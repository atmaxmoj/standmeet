# mail-connector — Mail: real send across SMTP + SaaS

- **Module:** The mail connector actually delivers — access-code emails, recovery phrases, test sends — over a real authenticated SMTP relay and over a real SaaS provider. It classifies real reply codes correctly and fails in one sentence the owner can act on. A verified connector un-gates approving access requests, the gate's request-access block, and recovery-phrase generation.
- **Surface:** `/admin/connectors` (the mail card), `/admin/requests` (approve), `/admin/account` (recovery), and `/gate` (request-access).
- **Real dep:** A real SMTP relay requiring STARTTLS and AUTH, with an inbox you can read. Optionally a real SaaS mail provider with a verified sender.
- **Backing e2e:** `mail-connector` · `admin-requests` · `gate-request-access` · `recovery-phrase` · `password-reset` · `connector-protocol-smtp` · `connector-openapi-mail` · `connector-err-smtp-fail` · `connector-mail-rotate-creds-reverify`.

## Checks

### 1 — An approved request emails a code that works ⭐
- **Steps:** Submit request-access from the gate with a real address. Approve it in admin. Open the real inbox. Read the code. Redeem it.
- **Expected:** The mail arrives in the real inbox, not in a local catcher. The code redeems and a session opens.
- **Backing test:** `mail-connector.spec.ts` · `admin-requests.spec.ts` · `gate-request-access.spec.ts`

### 2 — The gate's refusal names something the owner can find ⭐
- **Steps:** With mail disconnected, press approve on a request. Copy the sentence you get. Then go to the connectors page and look for the noun that sentence used.
- **Expected:** The sentence names the connector by the same word the connectors page uses, so the owner knows where to go and what to look for. Connect and verify, press approve again, and the block lifts.
- **Mock gap:** A spec can assert the string. It cannot assert that the noun is findable, which needs opening a different page and comparing. The channel name comes from the composition root, so an instance wired to a different category should say a different word — only a real instance shows which one it bound.
- **Backing test:** `admin-requests.spec.ts` (the string) · the noun being findable → `gap`

### 3 — A recovery phrase reaches the owner and works once
- **Steps:** Generate a recovery phrase. Read it from the real inbox. Use it to sign a locked-out owner in. Try the same phrase again.
- **Expected:** The mail arrives, the phrase signs the owner in, and the second attempt is refused.
- **Backing test:** `recovery-phrase.spec.ts` · `password-reset.spec.ts`

### 4 — The real handshake completes and reply codes are classified ⭐
- **Steps:** Connect the protocol connector against a real relay that demands STARTTLS and AUTH. Send. Then provoke the failures a real relay will produce on demand: a rejected authentication, a port with nothing listening, and a sender address the account is not allowed to use. Read the outcome for each.
- **Expected:** The upgrade and authentication succeed. Each class the relay does return maps to its own outcome, rather than every result collapsing into one. Where the relay accepts and fails later instead of refusing — a bad recipient it bounces asynchronously, a foreign sender it silently rewrites — the send says it was accepted and does not claim delivery.
- **Mock gap:** The mock relay advertises no STARTTLS and no AUTH and answers every command with success. It cannot produce any failure, so "each class lands in its own bucket" is not even expressible in CI. The classification's only real input is a real provider's reply.
- **Note:** An oversized message and a throttled send were named here first, and neither can be reached from this product against a real provider — the test-send composes a small message with no attachment, and a daily rate limit does not arrive on request. A relay stood up to return those codes is a rig, which is what the mock gap above already says is worthless here.
- **Backing test:** `connector-protocol-smtp.spec.ts` · `connector-err-smtp-fail.spec.ts` · classification itself → `gap`

### 5 — The SaaS path delivers and reports its id from the right place
- **Steps:** Assemble a SaaS mail connector with an API key and a verified sender. Send. Read the response status and where the message id came from.
- **Expected:** The provider accepts it and the message id is read from the response header the provider actually uses.
- **Mock gap:** The mock returns the id in the body instead of the header, and checks no API key, so neither is exercised.
- **Backing test:** `connector-openapi-mail.spec.ts`

### 6 — Each failure reads as one actionable sentence ⭐
- **Steps:** Press the test-send three times, each against a real failure. First a recipient at a domain that does not exist. Then a port with nothing listening. Then with the connector disconnected. Copy each sentence. For each, ask whether you now know what to change.
- **Expected:** Three different sentences, each naming the next step: check the recipient, try again later, connect one first. All three render in the UI, not only in a payload. None carries a status code, a hostname or a stack trace. The success path says which kind delivered it.
- **Note:** The bar is not "is there a reason field". It is "after reading it, do I know what to change". A diagnostic button that answers "failed" tells the owner what they already knew.
- **Backing test:** `connector-err-smtp-fail.spec.ts` · the three-way classification → `gap`

### 7 — A rotated credential keeps delivering
- **Steps:** Rotate the mail credential. Re-verify. Send a test.
- **Expected:** The send still delivers after the rotation.
- **Backing test:** `connector-mail-rotate-creds-reverify.spec.ts`

### 8 — A failed confirmation does not undo the thing it was confirming
- **Steps:** Make a booking whose confirmation send will fail. Complete it. Check the calendar.
- **Expected:** The booking is kept. Only the send failed, and the message says so.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The mail card states its true connected and verified state, and the approve button is enabled exactly when that state says it should be.
Any gate that tells the owner to go and do something must name it in a word that appears on the page it sends them to.
The requests list and its count badge agree.
