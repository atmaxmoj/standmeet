# skills-single-entrance — ONE skills door in the sidebar, not two to the same registry

- **Status:** ✅ verified — rot-D1 single /admin/skills, tabs installed/marketplace, heat graph gone, 6=6
- **Module:** admin nav / one-concept-one-door. A registry with a marketplace is ONE surface: the
  owner's skill list and the browse/install marketplace belong under a single entrance as tabs.
- **Surface:** `/admin/skills` (the merged home) + `/admin/agent-skills` (must fold in).
- **Intended fix:** merge into one `/admin/skills` with tabs "my skills" (the persona CRUD list) +
  "marketplace" (browse/install), drop the separate `agent skills` nav entry, and redirect the old
  `/admin/agent-skills` route to `/admin/skills` so no bookmark or scan-QR trail dead-ends.
- **Backing e2e:** `skills-single-entrance.spec.ts` (RED→GREEN: one nav entry, old route redirects,
  marketplace reachable as a tab on `/admin/skills`).

## Checks

### 1 — the sidebar has exactly ONE skills entrance ⭐
- **Steps:** log in, open `/admin`, read the whole left nav top to bottom.
- **Expected:** exactly one nav link leads to skills (label "skills"). There is **no** second "agent
  skills" link in the integrations group. The one entry is where both the owner's skills and the
  marketplace live.
- **⚠️ the bug this came from:** two doors (`skills` in jobs, `agent skills` in integrations) to one
  registry. The owner edited a skill under one and it silently was the same list as the other.
- **Result:** ✅ — rot-D1: exactly one /admin/skills entrance in the sidebar.
### 2 — visiting the old `/admin/agent-skills` lands on `/admin/skills`
- **Steps:** paste `/admin/agent-skills` into the address bar (or follow an old bookmark) and load it.
- **Expected:** the owner ends up on `/admin/skills` — a redirect, not a distinct page. No dead second
  door: either it forwards, or that route no longer exists as its own surface.
- **⚠️ the bug this came from:** the second door was a real route rendering `AgentSkillsSection`; after
  the merge its URL must not strand the owner on an orphaned copy of the same registry.
- **Result:** ✅ — old /admin/agent-skills redirects to /admin/skills.
### 3 — the marketplace is reachable as a tab on `/admin/skills`
- **Steps:** on `/admin/skills`, click the "marketplace" tab. Wait for the browse grid to load.
- **Expected:** the marketplace (search + install cards) is present as a tab beside "my skills" on the
  **same** page that shows the owner's skill list. Installing a skill there lands it in "my skills" on
  the same surface — no cross-door round trip.
- **⚠️ the bug this came from:** the marketplace lived only under the separate `/admin/agent-skills`
  door; `/admin/skills` had no way to reach it.
- **Result:** ✅ — marketplace reachable as a tab on /admin/skills.
## ⚠️ LOOK — fresh-eyes UI sanity
Two nav labels that are near-synonyms ("skills" / "agent skills") in two different groups are a tell
for the duplicate-door class: **one concept, one data source, must have one entrance.** If editing in
one place changes what a second place shows, they were never two things — collapse them.

## Findings
- **rot-D1** — `/admin/skills` and `/admin/agent-skills` were two nav doors to one registry (installed
  list = `useSkills().skills`; marketplace install writes the same repo). Fix: merge into a single
  tabbed `/admin/skills` (my skills · marketplace); drop the `agent skills` nav entry; redirect
  `/admin/agent-skills` → `/admin/skills`.
