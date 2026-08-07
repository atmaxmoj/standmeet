# dock-buttons — Owner-configured chat shortcuts

- **Module:** The owner binds at most two capabilities to shortcut buttons on a role. The visitor sees them in the chat dock with a resolved title, and clicking one sends its trigger as a visitor message, which fires the real capability. This is the only owner-authored affordance a visitor can press.
- **Surface:** `/admin/roles` for the config, and the visitor chat dock for the buttons.
- **Real dep:** A real model, because the trigger fires a real turn. The booking button additionally needs a connected calendar (see [[calendar-connect]]).
- **Backing e2e:** `dock-buttons` · `dock-buttons-mcp` · `floating-chat-dock`.

## Checks

### 1 — Both config surfaces agree
- **Steps:** Bind a capability and a trigger in the admin UI. Read it back through owner MCP. Then set a different one through MCP and read it back in the admin UI.
- **Expected:** Whichever surface wrote it, the read-back is identical. This is a facade-parity surface, so a difference between the two is the defect.
- **Backing test:** `dock-buttons.spec.ts` · `dock-buttons-mcp.spec.ts`

### 2 — The admin UI shows a title, not an identifier
- **Steps:** Bind a capability. Reload the role editor. Read the button's label.
- **Expected:** A human-readable capability title. A raw identifier means the owner is configuring something they cannot name.
- **Backing test:** `dock-buttons.spec.ts`

### 3 — The two-button limit reads as a limit
- **Steps:** Try to configure a third button, through both surfaces.
- **Expected:** Refused with a sentence naming the limit. Not a silent truncation and not a 500.
- **Backing test:** `dock-buttons.spec.ts`

### 4 — An invalid or ungranted capability is refused at bind time
- **Steps:** Bind a capability the role does not have, and one that does not exist.
- **Expected:** Both refused while configuring. A button that dead-ends when the visitor clicks it is what this prevents.
- **Backing test:** `dock-buttons.spec.ts`

### 5 — The visitor sees only what their code allows ⭐
- **Steps:** Issue a code on the role and enter chat. Read the dock and the session payload. Then deny that capability at the code level and enter again.
- **Expected:** The session carries each button with its resolved title. The granted button renders. The denied one is absent from the payload — filtered on the server, not hidden in the browser.
- **Backing test:** `floating-chat-dock.spec.ts` · `dock-buttons.spec.ts`

### 6 — Clicking runs the capability for real ⭐
- **Steps:** Click a button in a real session. Watch the trigger appear as a message. Read what the turn produces.
- **Expected:** The configured trigger is sent, a real turn runs, and the underlying capability actually happens. A message that lands and produces nothing is a failure. A model that declines for a good reason — nothing to summarize yet — is not.
- **Mock gap:** CI asserts the trigger was sent to a scripted model. Whether a real model honours the trigger and performs the capability is untested.
- **Backing test:** `floating-chat-dock.spec.ts`

### 7 — A live session's dock does not change under it
- **Steps:** Open a visitor session. Change the role's buttons in admin. Reload the visitor's page.
- **Expected:** The live session keeps the buttons it was assembled with. A newly issued session picks up the change.
- **Backing test:** `dock-buttons.spec.ts`

### 8 — A session issued through any path renders its dock at once
- **Steps:** Issue a session through code entry. Read the dock. Then issue one through the name-switch picker. Read the dock again, before reloading.
- **Expected:** Both render the dock immediately. A payload that carries buttons the page does not show until a reload is a state-propagation defect, not a config one.
- **Backing test:** `gap`

### 9 — A role with no buttons shows no dock
- **Steps:** Enter as a visitor on a role with no dock buttons.
- **Expected:** No dock, no empty slots, no placeholders.
- **Backing test:** `dock-buttons.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Admin side: titles are resolved, and the limit reads as a limit rather than as a silent drop.
Visitor side: each button carries a human title and clicking it visibly starts something.
A shortcut that fires nothing belongs to the dead-affordance class this audit keeps finding.
A role with none shows nothing at all, rather than an empty dock frame.
