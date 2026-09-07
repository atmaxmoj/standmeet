# code-rotation — a leaked access code can be replaced without losing what it built

- **Module:** The owner changes an access code's literal string. The code's identity does not change, so everything keyed on it survives; only the old string stops resolving, and the sessions already open on it are cleared. The owner is told what breaks before it happens.
- **Surface:** `/admin/codes` — a live code's card, its change action, and the warning modal that gates it. The same operation on owner MCP.
- **Real dep:** A running instance with a live code that has already been used: an issued résumé PDF or a shared link carrying the old string, and a visitor session open on it.
- **Exclusive:** none
- **Backing e2e:** `code-rotation` · `code-change-ui` · `admin-codes-extended` · `revoke-purges-session`.

## Checks

### 1 — The old string stops working and the new one works ⭐
- **Steps:** Note a live code's string. Change it. Open the visitor surface with the old string, then with the new one.
- **Expected:** The old string is refused and lands on the gate. The new string opens the chat.
- **Backing test:** `code-rotation.spec.ts`

### 2 — Everything keyed on the code's identity keeps working ⭐
- **Steps:** Before changing, note an embed bound to this code, a committed application issued from it, and its `/c/<slug>` landing path. Change the string. Exercise all three.
- **Expected:** The embed still loads, the application row still names this code, and the landing path still resolves. None of them referenced the string.
- **Mock gap:** Which things are keyed on the id and which on the string is only observable once each has real stored rows behind it.
- **Backing test:** `code-rotation.spec.ts`

### 3 — A session open on the old string dies with it
- **Steps:** Open a visitor chat on the code and leave it. Change the string. Send another message from that open tab.
- **Expected:** The turn is refused and the visitor is asked for a code again. A leaked live token does not outlive the rotation.
- **Backing test:** `code-rotation.spec.ts` · `revoke-purges-session.spec.ts`

### 4 — The owner is warned before it happens, in their own language
- **Steps:** Start the change from the card and read the modal. Cancel. Switch the admin to another locale and read it again.
- **Expected:** The modal states what stops working — already-sent PDFs and QR codes, shared links, live sessions — and what keeps working. Cancelling changes nothing. The text is the locale's, not a key or English.
- **Backing test:** `code-change-ui.spec.ts`

### 5 — A string another code already uses is refused
- **Steps:** Try to change a code to a string a second live code holds. Try it again differing only in letter case.
- **Expected:** Both are refused, and the message says the string is taken rather than reporting a server fault.
- **Backing test:** `code-rotation.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The card's string is a claim about what opens the instance: after a change it must read as the new one everywhere the old one appeared, including any list that summarises it.

The codes list and the conversations list are two views of one code — a rotation must leave the same conversations attached to it, under the new string.

Every control on a code card must act on that code: an action that opens a modal and then does nothing on confirm, and one that acts without the modal, are the two halves of the same defect.
