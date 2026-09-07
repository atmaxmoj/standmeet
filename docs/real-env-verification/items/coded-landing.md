# coded-landing — a redeemed code gets a stable address, and the address is not the credential

- **Module:** Each access code carries a landing path of its own. Once a visitor redeems the code, the address bar reads that path instead of the raw code, so the conversation has somewhere to live and the code stops travelling in the URL. The path locates; it does not admit.
- **Surface:** `/c/<slug>` as a visitor sees it, and the per-code landing field on `/admin/codes`.
- **Real dep:** A running instance with a live code. A second browser profile with no session, to reach the path as a stranger.
- **Exclusive:** none
- **Backing e2e:** `coded-landing-slug` · `microsite-is-the-codes-rendering` · `microsite-code-binding` · `admin-codes-extended`.

## Checks

### 1 — Redeeming rewrites the address, and the code leaves it ⭐
- **Steps:** Open the instance with `?code=` on a live code. Read the address bar once the chat is up. Reload from that address.
- **Expected:** The bar reads the code's landing path and no longer contains the code. The reload returns to the same conversation rather than to the gate.
- **Backing test:** `coded-landing-slug.spec.ts`

### 2 — The path alone grants nothing ⭐
- **Steps:** From a browser with no session, open the landing path directly.
- **Expected:** It does not open the chat. The visitor is asked for a code, exactly as a stranger at the front door would be.
- **Mock gap:** Whether the path is a credential shows only against a real session store; a fixture that hands out a session on any path cannot fail this.
- **Backing test:** `coded-landing-slug.spec.ts`

### 3 — A code bound to a microsite lands on that page
- **Steps:** Bind a microsite to a code. Redeem the code.
- **Expected:** The visitor lands on that page rather than on the built-in chat, and the page's agent answers under that code's grants.
- **Backing test:** `microsite-code-binding.spec.ts` · `microsite-is-the-codes-rendering.spec.ts`

### 4 — The landing path is visible and settable where the code is
- **Steps:** Open the code's card and read its landing path. Change it and redeem the code again.
- **Expected:** The card shows the path a visitor will see. After the change the visitor lands on the new one.
- **Backing test:** `admin-codes-extended.spec.ts`

### 5 — Two codes never share a path
- **Steps:** Issue several codes in succession and read their landing paths.
- **Expected:** Each is distinct. No two codes send a visitor to the same address.
- **Backing test:** `coded-landing-slug.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The address bar is a label a visitor reads: after redeeming, nothing in it may still spell the code, on any surface the visitor can reach.

The card's landing field and the address a visitor actually arrives at are two views of one path — say which differs.

Every path shown to the owner must be openable: a landing address printed on a card that resolves to the gate when pasted is a name that lies.
