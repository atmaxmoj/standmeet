# owner-sessions — the owner can see every place they are signed in, and end any of them

- **Module:** The instance lists the owner's live logins, marks the one being used to look, and lets any of them be ended from here. Signing out ends the session on the server, not only in the browser holding it.
- **Surface:** `/admin/system` — the active-sessions panel; the sign-out control in the admin shell and its confirmation.
- **Real dep:** A running instance and two live owner logins, one of which is not the browser doing the looking — a second browser or a separate API login.
- **Exclusive:** none
- **Backing e2e:** `owner-sessions-panel` · `owner-signout-kills-session` · `session-cookie-auth`.
- **Note:** Session fixation and cookie scoping are covered by their own specs and have nothing a person can look at. They are not checks here; this module is what the owner can see and do.

## Checks

### 1 — Every live login is listed, and the current one is marked ⭐
- **Steps:** Sign in from a second place. Open the panel in the first.
- **Expected:** Both appear. The one doing the looking is marked as current, and the other is not.
- **Backing test:** `owner-sessions-panel.spec.ts`

### 2 — Revoking another session ends it on the server ⭐
- **Steps:** Revoke the other session from the panel. From that other place, make an authenticated request.
- **Expected:** It is refused. The other place is signed out rather than continuing until its own cookie expires.
- **Mock gap:** Whether the token is dead is a fact about the session store; a panel that merely drops the row from a list would pass any check made in the panel.
- **Backing test:** `owner-sessions-panel.spec.ts`

### 3 — Signing out ends the session rather than only the cookie
- **Steps:** Capture the session token, sign out through the shell, then replay a request with that token.
- **Expected:** The request is refused. Signing out asks for confirmation first, and cancelling leaves the session alive.
- **Backing test:** `owner-signout-kills-session.spec.ts`

### 4 — The panel says enough to recognise a session
- **Steps:** Read each row.
- **Expected:** Each carries something that distinguishes it from the others — where it is signed in from and when it was last active — so the owner can tell which one to end.
- **Backing test:** `owner-sessions-panel.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The word "current" is a claim: exactly one row may carry it, and it must be the browser reading the panel.

The panel and the instance's actual behaviour are two views of one set of logins — a row removed from the list while its token still works is the defect this module exists for.

Every revoke control must end something: a button that removes a row and leaves the session alive reads to the owner as security they do not have.
