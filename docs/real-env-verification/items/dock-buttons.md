# dock-buttons — Owner-configured chat shortcuts (summarize / booking)

- **Status:** 🟡 (2026-07-15 live) — check 7 ✅ (public role has no dock buttons → none rendered, no empty slots); config + trigger-fire + snapshot-freeze checks pending (need a role with dock buttons configured)
- **Module:** the owner binds ≤2 capabilities (canonically **summarize** and **booking**) to shortcut buttons on a role; the visitor sees them as buttons in the chat dock with a resolved title; clicking one sends its **trigger** as a visitor message, firing the real capability. The owner's shortcut into the visitor's chat — the only owner-authored affordance a visitor can press.
- **Surface:** admin/roles → `RoleDockConfig` (owner config) · visitor chat dock (the two button slots).
- **Real dep:** prod stack + real DeepSeek (the trigger fires a real agent turn); **booking** additionally needs a connected calendar (see [[calendar-connect]] / [[booking-book]]); **summarize** pairs with [[chat-summarize]].
- **Backing e2e:** `dock-buttons` · `dock-buttons-mcp` · `floating-chat-dock`.

> **Two config surfaces, one truth.** The owner can set these from the admin UI (`RoleDockConfig.tsx`) **and** from the owner MCP (`roles.set_dock_buttons`, `cap_roles.go:64` → `usecases.SetRoleDockButtons`). Both must agree — this is a facade-parity surface ([[facade-parity design]]).
>
> **The config is frozen per session.** Dock buttons are captured into the `RoleSnapshot` at session assembly (`role_snapshot.go:151` — "冻下的 ≤2 个 dock 按钮配置", defensive copy), so changing a role's buttons must NOT mutate a live visitor session's dock.

## Checks

### 1 — Owner configures dock buttons on a role (both surfaces agree)
- **Steps:** in admin/roles, bind a capability to a dock button with a trigger phrase; read it back. Then set the same via owner MCP `roles.set_dock_buttons` and read back through the admin UI.
- **Expected:** whichever surface wrote it, the read-back is identical (`{capability_id, trigger}`); the admin UI renders the button with a **resolved title**, not a raw `capability_id`.
- **Backing test:** `dock-buttons.spec.ts` (admin) · `dock-buttons-mcp.spec.ts` (MCP surface)
- **Result:** ⬜

### 2 — The ≤2 cap is enforced
- **Steps:** attempt to configure a 3rd dock button.
- **Expected:** refused with a friendly error (`MaxDockButtons = 2`, `ErrTooManyDockButtons`, `role_dock_buttons.go:16/25`) — not a silent truncation, not a 500.
- **Backing test:** `dock-buttons.spec.ts`
- **Result:** ⬜

### 3 — Capability validity is checked at bind time
- **Steps:** bind a dock button to a capability id that doesn't exist / isn't granted to that role.
- **Expected:** refused at config time (the registry is consulted — `cap_roles.go:24` notes `set_dock_buttons` validates capability validity), rather than surfacing a button that dead-ends at click.
- **Result:** ⬜

### 4 — The visitor sees them, resolved and code-deny-filtered ⭐
- **Steps:** issue a code on that role → enter chat as the visitor → inspect the dock. Then deny that capability at the **code** level and re-enter.
- **Expected:** the session payload carries `dock_buttons: [{capability_id, title, trigger}]` (`sessions.go:65`) with `title` resolved; the granted button renders in its slot; the **code-denied** capability's button does **not** surface at all (filtered server-side, not hidden client-side).
- **Backing test:** `floating-chat-dock.spec.ts` · `dock-buttons.spec.ts`
- **Result:** ⬜

### 5 — Clicking fires the trigger and the capability really runs ⭐
- **Steps:** click the **summarize** dock button in a real coded session with real DeepSeek; then (with a connected calendar) click **booking**.
- **Expected:** the click sends the configured `trigger` as a visitor message; the real agent turn runs the underlying capability — summarize produces a faithful summary of the actual conversation ([[chat-summarize]]); booking reaches the real calendar path ([[booking-book]]). Not a no-op, not a message that just sits there.
- **⚠️ mock gap:** CI drives the click + asserts the trigger is sent against the scripted LLM; whether the **real** model then honors the trigger and performs the capability is untested.
- **Result:** ⬜

### 6 — Snapshot freeze: changing the role mid-session doesn't mutate a live dock
- **Steps:** open a visitor session, then change the role's dock buttons from admin → observe the live session.
- **Expected:** the live session keeps the buttons frozen at assembly time (`RoleSnapshot`); a NEW session picks up the change.
- **Result:** ⬜

### 7 — A role with no dock buttons shows none
- **Steps:** enter as a visitor on a role with `dock_buttons: []`.
- **Expected:** no empty slots, no placeholder buttons, no dead affordance — the dock is simply absent.
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Admin side: the dock config renders **resolved capability titles**, not raw ids; the ≤2 limit reads as a limit (not a silent drop). Visitor side: each button shows a human title, sits in its slot, and **clicking does something visible** (the trigger appears as a message and a turn starts) — a shortcut that fires nothing is the F-N-1 dead-affordance class. A role with none shows no empty dock.

## Findings
(record here during the manual phase; also log `../findings.md`, historical anchor `F-A-n` for the chat surface / `F-B-n` for the booking leg)

- **Latent (not logged, no live exposure):** `roles.go:40` declares `DockButtons []domain.DockButtonConfig` with `json:"dock_buttons"` (**no** `omitempty`), so a nil slice would marshal to `null`, and both consumers (`use-roles.ts:29`, `use-gate.ts:72`) declare `dock_buttons: z.array(...).optional()` with no `.nullable()` — the exact `F-D-1` trap. Live `/api/admin/roles` currently returns `[]`, so nothing fires today. Closing `F-D-1` at the source (never emit a nil slice) should cover this too.
