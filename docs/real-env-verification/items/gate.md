# gate — Visitor gate: code entry, BYOAI panel, request-access, identity

- **Status:** ⬜ not started (new round)
- **Module:** the no-code visitor entry surface — code-entry validates+redeems, the BYOAI panel accepts a key, request-access submits, and the identity-picker modal behaves (doesn't re-pop over an active session).
- **Surface:** `/gate` + the visitor identity-picker modal.
- **Real dep:** prod stack; real DeepSeek + real mail for the downstream legs (which live in [[chat-byoai]], [[access-codes]], [[mail-connector]]).
- **Inherits (historical finding IDs):** `F-A-5` (identity picker re-popped over an active session — ✅ fixed, 338cf6b/regressed on real prod GUI).
- **Backing e2e:** `gate-code-ux` · `gate-request-access` · `gate-byoai-ux` · `chat-welcome`.

## Checks

### 1 — Code entry validates + redeems
- **Steps:** enter a valid code → redeems into a scoped session; enter a wrong code repeatedly → per-IP lockout + captcha demand (see [[captcha]]).
- **Expected:** valid code opens a session; the `/gate?q=…` handoff carries a homepage question and auto-submits it as the first message.
- **Backing test:** `gate-code-ux.spec.ts` · `access-codes.spec.ts`
- **Result:** ⬜
### 2 — BYOAI panel renders + accepts a key
- **Steps:** open the BYOAI panel → provider/endpoint/model/key → submit → land on `/<handle>?byoai=1` (real answer leg → [[chat-byoai]]).
- **Expected:** the panel renders and accepts a key; the welcome states public scope.
- **Backing test:** `gate-byoai-ux.spec.ts` · `chat-welcome.spec.ts:46`
- **Result:** ⬜
### 3 — Request-access submits (no-code handoff)
- **Steps:** a no-code visitor submits request-access with an inbox address → recorded (approve leg → [[access-codes]] / [[mail-connector]]). A no-code ask hands off to `/gate` carrying `?q=` — no inline chat.
- **Expected:** the request-access block submits and confirms; the gate handoff preserves the question.
- **Backing test:** `gate-request-access.spec.ts:40`
- **Result:** ⬜
### 4 — Identity picker doesn't re-pop over an active session  (was F-A-5)
- **Steps:** enter a coded session → the identity picker appears once → after picking, it must **not** re-pop over the active session.
- **Expected:** the picker resolves identity once and stays gone for the active session.
- **⚠️ finding (fixed):** F-A-5 — the picker re-popped over an active session; fixed (338cf6b) and regressed on the real prod GUI.
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
`/gate` renders all three blocks (code entry / BYOAI panel / request-access) — none empty or dead; the identity modal appears once and doesn't re-pop; a submitted request confirms.

## Findings
(record here; also log `../findings.md`, ID `F-A-5` historical anchor)

- **F-A-5 ✅fixed** — identity picker no longer re-pops over an active session (regressed on real prod GUI).
