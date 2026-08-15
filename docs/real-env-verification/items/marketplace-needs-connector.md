# marketplace-needs-connector — the "needs X connector" hint must track REAL connector state

- **Module:** The marketplace card's connector-requirement warning. It reflects the owner's real connector state, never a constant.
- **Surface:** `/admin/skills` → MARKETPLACE tab → a card whose skill declares a connector requirement.
- **Real dep:** A real connector the owner can connect and disconnect (see [[calendar-connect]] / [[mail-connector]]).
- **Backing e2e:** `marketplace-needs-connector.spec.ts`.

## Checks

### 1 — The hint moves with the owner's real connector state ⭐
- **Steps:** Start from an instance with no connectors connected. Open `/admin/skills` → MARKETPLACE. Find a skill whose `SKILL.md` declares a connector requirement. Read its card. Connect that connector. Reload and read the card again. Disconnect it. Reload and read the card a third time.
- **Expected:** The card shows the "needs X" hint while the connector is absent. The hint clears once the connector is connected. The hint returns after a disconnect.
- **Mock gap:** No real search result carries a `needs` value yet, so the backing spec pins the search response to a skill that declares one. A live search cannot exercise this until the backend derives the field — and deriving it is not a wire change: a skill declares the *tools* it uses, a capability declares the *connectors* it requires, and the host has no single home for the map between them (a sandboxed capability's visitor tool names are known only when it is dialled). That missing map is the work.
- **Backing test:** `marketplace-needs-connector.spec.ts`

### 2 — The hint is addressable
- **Steps:** Inspect the hint element on a card that shows one.
- **Expected:** The element carries a stable testid, so a guard can assert the hint without matching prose.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Toggle a real connector off and on, then read the per-skill warnings again.
A warning that does not change is painted from a constant, not measured from your connectors.
Same tell as the rest of the fabricated-state class: it does not move when the thing it claims to reflect moves.
