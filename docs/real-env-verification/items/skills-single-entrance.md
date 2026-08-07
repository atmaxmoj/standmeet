# skills-single-entrance — ONE skills door in the sidebar, not two to the same registry

- **Module:** Admin nav, one concept one door. A registry with a marketplace is one surface: the owner's skill list and the browse-and-install marketplace live under a single entrance, as tabs.
- **Surface:** `/admin/skills`, plus the legacy `/admin/agent-skills` route.
- **Real dep:** none.
- **Backing e2e:** `skills-single-entrance.spec.ts`.

## Checks

### 1 — The sidebar holds exactly one skills entrance ⭐
- **Steps:** Sign in. Open `/admin`. Read the whole left nav from top to bottom. Count the links that lead to skills.
- **Expected:** Exactly one nav link leads to skills. No second near-synonym entry exists in any other group. That one entry is where both the owner's skills and the marketplace live.
- **Backing test:** `skills-single-entrance.spec.ts`

### 2 — The old route lands the owner on the surviving one
- **Steps:** Paste `/admin/agent-skills` into the address bar. Load it. Read the final route.
- **Expected:** The owner ends on `/admin/skills`. The old path does not render its own copy of the registry, so an old bookmark cannot strand the owner on an orphan.
- **Backing test:** `skills-single-entrance.spec.ts`

### 3 — The marketplace is a tab on the same page as the skill list
- **Steps:** Open `/admin/skills`. Click the marketplace tab. Wait for the grid. Install a skill. Read where you land.
- **Expected:** The marketplace sits beside the owner's list on the same page. An install lands in that same list, with no round trip to another door.
- **Backing test:** `skills-single-entrance.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Two nav labels that are near-synonyms, sitting in two different groups, are the tell for the duplicate-door class.
One concept with one data source gets one entrance.
If editing in one place changes what a second place shows, they were never two things.
