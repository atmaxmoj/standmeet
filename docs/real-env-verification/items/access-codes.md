# access-codes — Access codes / invitations: issue, list, QR, revoke, redeem

- **Module:** The owner's access-code management. A code issues, renders in the list, shows its QR and its members, quota and expiry, revokes, and redeems end to end. An access code IS an invitation.
- **Surface:** `/admin/codes`, plus `/gate` to redeem and `/admin/requests` to approve.
- **Real dep:** The prod stack. A real mail connector for the emailed-code path (see [[mail-supplier]]). A live code that has already been used — an issued résumé PDF or a shared link carrying its string, and a visitor session open on it — so a rotation has something to break.
- **Exclusive:** gmail-inbox
- **Backing e2e:** `access-codes` · `admin-requests` · `mail-connector` · `coded-landing-slug` · `code-rotation` · `code-change-ui` · `admin-codes-extended` · `microsite-code-binding` · `revoke-purges-session`.

## Checks

### 1 — Every issued code renders in the list ⭐
- **Steps:** Issue a code. Open `/admin/codes`. Count the cards. Read the codes-live figure on the dashboard.
- **Expected:** The list shows every live code, and its length equals the dashboard figure. A count that is right beside a list that is empty is the failure this check exists for — the two read one dataset.
- **Mock gap:** `access-codes.spec.ts` drives issue and redeem through the API, so an empty list never fails it.
- **Backing test:** `access-codes.spec.ts` (API) · the list rendering → `gap`

### 2 — A card carries what the owner needs to share and to police the code
- **Steps:** Read one card. Find its QR, its member count against its cap, and its expiry. Click copy-share. Click revoke.
- **Expected:** The QR renders. The member count states consumption, not only the cap. The expiry is a date. Both controls fire and their effect is visible without a reload.
- **Backing test:** `access-codes.spec.ts`

### 3 — Request → approve → emailed code → redeem, as one journey
- **Steps:** As a no-code visitor, submit a request on `/gate`. As the owner, find it in `/admin/requests` and approve it. Open the real inbox. Follow the emailed link. Take a turn in the session it opens.
- **Expected:** The chain completes with real mail. The emailed code opens a working session.
- **Mock gap:** No spec walks the whole journey. CI proves the request list, the approve gate and redemption separately, and the mail hop is always a local catcher.
- **Backing test:** `admin-requests.spec.ts` · `mail-supplier.spec.ts` · `access-codes.spec.ts` · the joined journey → `gap`

### 4 — Approve is refused without a way to deliver
- **Steps:** With no verified mail connector, approve a request.
- **Expected:** The approval is refused, and the reason names the missing connector.
- **Backing test:** `admin-requests.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The codes list and the dashboard figure state the same number, on one screen and after a mutation.
Every QR renders, so the owner can actually hand a code over.
The requests list length equals its own count.
Every quota on a card reports consumption against its cap — a cap alone makes a full code look new.

### 5 — Redeeming rewrites the address, and the address is not the credential ⭐
- **Steps:** Open the instance with `?code=` on a live code and read the address bar once the chat is up. Reload from it. Then open that same address from a browser holding no session.
- **Expected:** The bar reads the code's own landing path with the code gone from it, and the reload returns to the same conversation. The bare path from a fresh browser opens nothing — the visitor is asked for a code, as a stranger at the front door would be.
- **Mock gap:** Whether the path is a credential shows only against a real session store; a fixture that hands out a session on any path cannot fail this.
- **Backing test:** `coded-landing-slug.spec.ts`

### 6 — A code bound to a page lands the visitor on that page
- **Steps:** Bind a microsite to a code, then redeem it.
- **Expected:** The visitor lands on that page rather than the built-in chat, and its agent answers under this code's grants.
- **Backing test:** `microsite-code-binding.spec.ts`

### 7 — A leaked code's string can be replaced without losing what it built ⭐
- **Steps:** Change a live code's string from its card, reading the warning first and cancelling once. Then confirm. Try the old string and the new one. Exercise an embed bound to this code, a committed application issued from it, and its landing path. Send a message from a tab that was already open on it.
- **Expected:** Cancelling changes nothing, and the warning states what stops working — already-sent PDFs and QR codes, shared links, live sessions — and what keeps working. After confirming, the old string is refused and the new one opens; the embed, the application and the landing path all still work, because none of them referenced the string; and the open tab is asked for a code again.
- **Backing test:** `code-rotation.spec.ts` · `code-change-ui.spec.ts`

