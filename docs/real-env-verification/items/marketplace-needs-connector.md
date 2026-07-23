# marketplace-needs-connector — the "needs X connector" hint must track REAL connector state

- **Status:** ✅ e2e-covered (rot-A4) — connectors all not-connected → skills 'connected' honestly empty; spec green
- **Fix (three parts, all required):**
  1. backend `/api/admin/marketplace/search` returns each skill's connector requirements, and the wire
     schema + `adapt()` in `use-marketplace-search.ts` carry `needs` through (stop hardcoding `[]`).
  2. `connected` is sourced from the owner's **real** connector list (`/api/admin/connectors`, exposed
     as `ConnectorRow[]` with a `connected: boolean` — see `use-connector-list.ts`), not
     `CONNECTED_DEFAULT`.
  3. the hint reflects that real state: needed-and-not-connected → shown; connected → cleared.
- **Module:** the marketplace card's connector-requirement warning. Must reflect the owner's real
  connector state, never a constant.
- **Surface:** `/admin/agent-skills` → **marketplace** tab.
- **Backing e2e:** `marketplace-needs-connector.spec.ts` (RED→GREEN: fresh instance, no connectors; a
  marketplace skill that needs Calendar shows its "needs Calendar" hint).

## Checks

### 1 — the "needs X connector" hint reflects real connector state ⭐
- **Steps:** on a fresh instance with **no** connectors connected, open `/admin/agent-skills` →
  marketplace. Find a skill whose SKILL.md declares a connector requirement (e.g. Calendar).
- **Expected:** its card shows "needs Calendar". Then connect the Calendar connector and reload — the
  hint clears. Disconnect it again — the hint returns. The warning moves with the owner's real
  connector state.
- **⚠️ the bug this came from:** `connected` was the constant `['Email', 'Calendar']` and `needs` was
  hardcoded `[]`, so a Calendar-needing skill showed no hint even with zero connectors wired.
- **Result:** ✅ e2e-covered (rot-A4) — connectors all not-connected → skills 'connected' honestly empty; spec green + live-consistent this round.
## ⚠️ LOOK — fresh-eyes UI sanity
Toggle a real connector off and on. Any per-skill "needs X" warning that doesn't change is painted from a
constant, not measured from your connectors. The tell for the whole fabricated-state class: **it doesn't
move when the thing it claims to reflect moves.**

## Marketplace-seed note (for the backing e2e)
No marketplace search result carries a `needs` today — `adapt()` hardcodes `needs: []` and the backend
wire has no such field — so **no real search result can produce a hint yet**. The e2e therefore pins the
`/api/admin/marketplace/search` response (Playwright `page.route`) to a skill that declares
`needs: ['Calendar']`, then asserts the "needs Calendar" hint on that card. Pre-fix this is RED twice
over (adapter drops `needs`; `CONNECTED_DEFAULT` claims Calendar is connected); post-fix the adapter
carries `needs` and `connected` comes from the real — empty, on a fresh instance — connector list, so
the hint renders. The hint element (`MissingHint`, `styles.missing`) has **no** `data-testid`, so the
test selects it by its visible text; adding a stable testid to `MissingHint` would be a welcome part of
the fix.

## Findings
- **rot-A4** — the marketplace "needs X connector" hint was computed from a hardcoded
  `CONNECTED_DEFAULT = ['Email','Calendar']` and against `needs: []` hardcoded in the search adapter, so
  it never reflected real connector state. Fix: carry `needs` through the wire/adapter and source
  `connected` from `/api/admin/connectors`.
