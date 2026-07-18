# custom-pages — Custom page hosting: create → build → promote → host

- **Status:** ⬜ not started (new round)
- **Module:** the owner authors a custom React page with the SDK; a sandboxed real Vite build produces static output hosted on the instance and served — and the admin create/build/promote flow actually works (not a dead button).
- **Surface:** admin/page (custom-pages).
- **Real dep:** prod stack (real sandbox build via the docker driver, see [[sandbox]]) + real storage/hosting.
- **Inherits (historical finding IDs):** `F-N-1` (the "+ NEW PAGE" button is dead — clicking does nothing).
- **Backing e2e:** `custom-page.spec.ts` (page surface) + [[sandbox]] specs (the build). Custom-page-build storage → no dedicated spec (gap).

## Checks

### 1 — Custom-page sandbox build → real static hosting  (was §I3)
- **Steps:** owner submits a custom React page using the SDK → the sandbox runs a **real Vite build** → the static output is hosted on the instance and served → open the built page and confirm it renders/chats.
- **Expected:** the real build succeeds in the sandbox (not a stubbed toolchain) and the static artifact is served from the instance.
- **Note:** the build isolation itself is [[sandbox]] (K2 prod docker-driver); here we care that *storage + hosting* of the built artifact works on the prod stack.
- **Backing test:** no dedicated custom-page-build storage spec (gap); nearest `custom-page.spec.ts` + sandbox specs.
- **Result:** ⬜
### 2 — The create/build/promote flow is not dead ⭐  (was F-N-1)
- **Steps:** on admin/page, click **"+ NEW PAGE"** → observe.
- **Expected:** a real create flow opens (modal / navigation / feedback) — OR the button is removed and the MCP-driven copy stands. Not a button that fires nothing.
- **⚠️ finding:** clicking "+ NEW PAGE" does nothing (no modal, no navigation, no feedback). The section's copy says the lifecycle is MCP-driven (`custom_page.create` / `.write_file` / `.build` / `.promote_to_live`) — so the button may have no GUI flow behind it. Same dead-affordance class as F-L-1 / UX-5. Either wire it to a real create flow, or remove it and let the MCP copy stand.
- **Backing test:** no spec clicks `+ NEW PAGE` and asserts a page gets created (a dead button fires nothing, so nothing fails today) — step-3 adds one.
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The page **list renders**; **"+ NEW PAGE" does something** (F-N-1); build/promote states are visible; a built page actually renders when opened.

## Findings
(record here; also log `../findings.md`, ID `F-N-1` historical anchor)

- **F-N-1** (owner-reported mid-audit): "+ NEW PAGE" is a dead affordance. 🔴 manual-red, needs step-3.
