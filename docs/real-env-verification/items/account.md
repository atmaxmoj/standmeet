# account — the owner changes their own identity without locking themselves out

- **Module:** One walk of the account section. The email on this row is both the login identity and the channel a lost password comes back through, so changing it is a two-step move that proves the new address receives mail before either use of it moves. The recovery phrase is generated here, and what the row says about itself matches what the button does.
- **Surface:** `/admin/account` — the name, the email block with its pending state, and the recovery row.
- **Real dep:** A real mail connector and a real inbox to read (see [[mail-supplier]]), because every step here is confirmed by something arriving rather than by the panel saying it sent.
- **Exclusive:** gmail-inbox
- **Note:** The current-password gate and its rate limit have their own specs and nothing a person can look at beyond one refusal; they are not checks here.
- **Backing e2e:** `account-email-change-needs-confirmation` · `account-email-pending-lifecycle` · `account-email-change-without-mail-supplier` · `account-recovery-row-tells-the-truth` · `account-current-password-gate` · `owner-email-normalized-at-every-entrance` · `recovery-phrase`.

## Checks

### 1 — Changing the email does not move the login until the new address answers ⭐
- **Steps:** Change the email to an address you can read. Before opening the confirmation, sign out and sign in with the old address. Then open the confirmation and sign in with the new one.
- **Expected:** The old address still signs in while the change is pending. After confirming, the new one does and the old one does not. A typo therefore costs nothing, because the old address never stopped working.
- **Mock gap:** The whole point is that a real message reaches a real inbox; a fixture that reports a send proves the opposite of what this check asks.
- **Backing test:** `account-email-change-needs-confirmation.spec.ts`

### 2 — A pending change is visible, and can be abandoned
- **Steps:** With a change pending, read the row. Cancel it, then read the row again. Start another and let the confirmation expire.
- **Expected:** The row says which address is waiting and that it is waiting. Cancelling returns it to the current address. An expired confirmation does not silently apply later.
- **Backing test:** `account-email-pending-lifecycle.spec.ts`

### 3 — With no way to send, the change is refused rather than half-made ⭐
- **Steps:** Disconnect the mail connector. Try to change the email.
- **Expected:** It is refused, and the message says the instance cannot reach the new address. The stored email is unchanged — the owner is not left with a pending change nothing can ever confirm.
- **Backing test:** `account-email-change-without-mail-supplier.spec.ts`

### 4 — The recovery row's words match what its button does
- **Steps:** Read the recovery row's description, then press it and read the resulting inbox.
- **Expected:** The row describes what actually happens. It does not say a thing is unbuilt while the button builds it, nor promise a message that never arrives.
- **Backing test:** `account-recovery-row-tells-the-truth.spec.ts` · `recovery-phrase.spec.ts`

### 5 — The address is the same address however it was typed
- **Steps:** Sign in, request recovery and change the email using the address with different capitalisation and surrounding spaces each time.
- **Expected:** All of them reach the same account. None creates a second identity or fails to match.
- **Backing test:** `owner-email-normalized-at-every-entrance.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Every line on this screen is a promise about the owner's ability to get back in: read each one and ask what would happen if it were wrong — this is the screen where being wrong locks the owner out of their own instance.

The row's stated state and the instance's actual state are two views of one identity: an address shown as current while a pending one would sign in, or a row describing a capability the button does not have, is the defect this module exists for.

Every control here must do the thing its own text describes, and say so afterwards: a save that reports success while the value is unchanged is indistinguishable, from the owner's chair, from one that worked.
