# custom-pages — Custom page hosting: create → build → promote → host

- **Module:** The owner authors a custom React page with the SDK. A sandboxed real Vite build produces static output, the instance hosts it, and the admin surface reflects the page's lifecycle.
- **Surface:** `/admin/custom-pages`, and the built page at its `/p/<slug>`.
- **Real dep:** The prod stack, with a real sandbox build through the docker driver (see [[sandbox]]) and real storage.
- **Backing e2e:** `custom-page` for the surface, plus the [[sandbox]] specs for the build. Storage and hosting of the built artifact → `gap`.

## Checks

### 1 — A real build produces a page the instance serves ⭐
- **Steps:** Author a page through the MCP lifecycle: create, write files, build, promote to live. Wait for the build. Open the page's public URL. Read it. Take a chat turn on it if it embeds chat.
- **Expected:** The build runs a real toolchain in the sandbox, not a stub. The static artifact is served from the instance. The page renders and its embedded features work.
- **Note:** Build isolation belongs to [[sandbox]]. What this check owns is storage and hosting of the artifact.
- **Backing test:** `custom-page.spec.ts` · artifact storage → `gap`

### 2 — Every affordance on the surface does something
- **Steps:** Open `/admin/custom-pages`. Click every control on the page, including any create button. Observe what each one does.
- **Expected:** Each control opens a flow, navigates, or gives feedback. A control that fires nothing does not exist here. If the lifecycle is MCP-driven, the copy says so and no button contradicts it.
- **Mock gap:** A dead button fires nothing, so nothing fails. Only a click by a human, or a spec that asserts the effect of the click, can reach this.
- **Backing test:** `gap`

### 3 — The list and its count agree
- **Steps:** Read the number of pages the section reports. Count the rows.
- **Expected:** The two match, before and after creating or removing a page.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Click every affordance and watch for a response — this surface is where dead buttons have hidden before.
Build and promote states are visible, so the owner knows whether a page is live.
A page that says it is live opens and renders when you follow its URL.
