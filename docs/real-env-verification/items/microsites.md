# microsites — Custom page hosting: create → build → promote → host

- **Module:** The owner authors a custom React page with the SDK. A sandboxed real Vite build produces static output, the instance hosts it, and the admin surface reflects the page's lifecycle. The homepage is one of these pages only once the owner has built one: an instance nobody has edited serves its default from code, so `/` works before any page exists. Writing the page and watching it render is [[microsite-editor]]; what a page stores is [[microsite-store]].
- **Surface:** `/admin/microsites`, and the built page at its `/p/<slug>`.
- **Real dep:** The prod stack, with a real sandbox build through the docker driver (see [[sandbox]]) and real storage.
- **Exclusive:** none
- **Backing e2e:** `microsite` for the surface, `homepage-auto-goes-live-at-claim` and `default-home-look` for the code-served default, `homepage-served-at-root` and `microsites-linked-on-public-surfaces` for hosting, plus the [[sandbox]] specs for the build.

## Checks

### 1 — A real build produces a page the instance serves ⭐
- **Steps:** Author a page through the MCP lifecycle: create, write files, build, promote to live. Wait for the build. Open the page's public URL. Read it. Take a chat turn on it if it embeds chat.
- **Expected:** The build runs a real toolchain in the sandbox, not a stub. The static artifact is served from the instance. The page renders and its embedded features work.
- **Note:** Build isolation belongs to [[sandbox]]. What this check owns is storage and hosting of the artifact.
- **Backing test:** `microsite.spec.ts` · artifact storage → `gap`

### 2 — Every affordance on the surface does something
- **Steps:** Open `/admin/microsites`. Click every control on the page, including any create button. Observe what each one does.
- **Expected:** Each control opens a flow, navigates, or gives feedback. A control that fires nothing does not exist here. If the lifecycle is MCP-driven, the copy says so and no button contradicts it.
- **Mock gap:** A dead button fires nothing, so nothing fails. Only a click by a human, or a spec that asserts the effect of the click, can reach this.
- **Backing test:** `gap`

### 3 — An untouched instance already has a front page ⭐
- **Steps:** On an instance where the owner has built no page, open `/`. Then read the microsites list.
- **Expected:** `/` serves a complete front page. The list does not claim a stored homepage that nobody made, and it offers a way to start editing one.
- **Mock gap:** The default is rendered from the code that is running, so only a real deployment shows what an owner actually lands on.
- **Backing test:** `homepage-auto-goes-live-at-claim.spec.ts` · `default-home-look.spec.ts`

### 4 — The list and its count agree
- **Steps:** Read the number of pages the section reports. Count the rows.
- **Expected:** The two match, before and after creating or removing a page.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Click every affordance and watch for a response — this surface is where dead buttons have hidden before.
Build and promote states are visible, so the owner knows whether a page is live.
A page that says it is live opens and renders when you follow its URL.
