# marketplace — Marketplace: real GitHub search + install

- **Module:** `marketplace.search` queries the real GitHub Contents API and lists candidate skills. Installing one fetches its `SKILL.md` and parses it into a local skill the owner owns.
- **Surface:** `/admin/skills` → MARKETPLACE tab → source filter → INSTALL. A paste-a-SKILL.md path exists on the same tab.
- **Real dep:** Real `api.github.com` Contents API. Unauthenticated works. `GITHUB_TOKEN` raises the 60/hr limit.
- **Backing e2e:** `admin-marketplace-install` · `admin-agent-skills`.

## Checks

### 1 — Search reaches real GitHub and lists real skills ⭐
- **Steps:** Open the MARKETPLACE tab. Set the source filter to GITHUB. Read the cards.
- **Expected:** Real skills from `anthropics/skills` appear, each with its name, author and description. A 403 rate-limit shows a sentence the owner can act on, not a crash and not an empty grid.
- **Mock gap:** The mock is flat, un-paginated and un-rate-limited. Real GitHub Contents is base64-per-file, paginated, ETag-conditional and 403-rate-limited. A real `SKILL.md` can be malformed or oversized. The mock reproduces none of that.
- **Backing test:** `admin-marketplace-install.spec.ts` (`searchGitHub` helper)

### 2 — Installing a real skill fetches and parses its SKILL.md ⭐
- **Steps:** Pick a GitHub skill. Click INSTALL. Return to MY SKILLS. Read the tracked count. Read the new row. Query `GET /api/admin/skills/` for its source.
- **Expected:** The tracked count rises by one. The installed skill carries `source = marketplace`. Its name, description and prompt come from the fetched `SKILL.md`. A malformed or oversized `SKILL.md` yields a sentence the owner can act on, not a crash.
- **Backing test:** `admin-marketplace-install.spec.ts`

### 3 — A card states what its number counts
- **Steps:** Read the badge on a GITHUB card. Read the badge on a SKILLSMP card. Compare the SKILLSMP badges of several skills by one author.
- **Expected:** A source that reports no per-skill figure prints no figure — never a zero. A source that reports repository stars says `repo`, so sibling skills sharing one number reads as a fact about the repository.
- **Backing test:** `admin-agent-skills.spec.ts` ("an unknown star count is not printed as zero")

### 4 — An installed skill can be removed, and a builtin cannot
- **Steps:** Read the controls on an installed marketplace skill's row. Read the controls on a builtin skill's row. Delete the installed one. Read the tracked count.
- **Expected:** The installed row offers `delete`. The builtin row does not. The count falls by one after the delete.
- **Backing test:** `gap`

### 5 — SkillsMP is out of scope
- **Steps:** None. Do not drive this source against reality.
- **Expected:** `api.skillsmp.com` does not exist, and `skillsmp.json` is hand-rolled. This source cannot be verified against reality. Flag it and move on.
- **Backing test:** `n/a`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Search results render whenever a real match exists, so a populated source never shows an empty grid.
Every badge on a card states what it counts, and prints nothing when the source cannot report it.
The INSTALL button fires, the skill appears in MY SKILLS, and its card says where it came from.
A rate-limit or a malformed `SKILL.md` reaches the owner as a sentence, never as a stack trace.
