# gate — Visitor gate: code entry, BYOAI panel, request-access, identity

- **Module:** The no-code visitor's entry surface. Code entry validates and redeems, the BYOAI panel accepts a key, request-access submits, and the identity picker resolves who the visitor is exactly once.
- **Surface:** `/gate`, plus the identity-picker modal.
- **Real dep:** A running instance. The downstream legs need real services and live in [[chat-byoai]], [[access-codes]] and [[mail-connector]].
- **Backing e2e:** `gate-code-ux` · `gate-request-access` · `gate-byoai-ux` · `chat-welcome`.

## Checks

### 1 — A valid code opens a scoped session ⭐
- **Steps:** Enter a valid code with a name. Submit. Read the session strip.
- **Expected:** The session opens, the strip shows it as invited, and it carries the name entered.
- **Backing test:** `gate-code-ux.spec.ts` · `access-codes.spec.ts`

### 2 — Every refusal says which refusal it is ⭐
- **Steps:** Enter a code that does not exist. Read the message. Enter a real code that is full. Read it again. Enter a revoked code. Read it a third time.
- **Expected:** Each case states its own reason in the words the backend used. A code that exists and is merely full is never reported as unknown, because the holder of a valid invitation would otherwise conclude the owner sent them a bad code.
- **Backing test:** `gate-code-ux.spec.ts`

### 3 — A question asked on the homepage survives the handoff
- **Steps:** Ask a question on the public page without a code. Follow the handoff to the gate. Enter a valid code.
- **Expected:** The question is carried through and submitted as the session's first message, so the visitor does not retype it. The public page offers no inline chat of its own.
- **Backing test:** `gate-code-ux.spec.ts`

### 4 — The BYOAI panel accepts a key and states the scope
- **Steps:** Open the BYOAI panel. Enter provider, endpoint, model and key. Submit. Read the welcome.
- **Expected:** The panel accepts the key and lands the visitor in chat. The welcome says the session is on the public slice.
- **Backing test:** `gate-byoai-ux.spec.ts` · `chat-welcome.spec.ts`

### 5 — Request-access submits and confirms
- **Steps:** As a no-code visitor, fill request-access with a real address. Submit.
- **Expected:** The form confirms. The approval and email legs belong to [[access-codes]] and [[mail-connector]].
- **Backing test:** `gate-request-access.spec.ts`

### 6 — The identity picker appears once and stays gone
- **Steps:** Enter a coded session. Answer the identity picker. Navigate around the surfaces. Take turns. Reload once.
- **Expected:** The picker resolves identity once and does not reappear over the active session. It returns only when the visitor asks to switch name.
- **Backing test:** `gate-code-ux.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

All three blocks render — code entry, BYOAI, request-access — and none of them is an empty frame.
A refusal reads as a sentence a stranger can act on, and it does not clear the field without saying why.
The identity modal appears once; a modal that re-pops over an active session reads as the product losing track of who you are.
