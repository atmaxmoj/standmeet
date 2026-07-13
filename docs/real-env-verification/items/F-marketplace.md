# §F — Real marketplace

- **Status:** ⬜ not-run
- **Scope:** public runnable · F3 SkillsMP 🚫fiction
- **Prereqs/creds:** none required — the real GitHub Contents API is queryable unauthenticated. Optionally set a `GITHUB_TOKEN` in `verify-creds.env` to raise the 60/hr anonymous rate limit toward 5000/hr (needed if F1 pagination hits 403).
- **Real service:** real `api.github.com` (Contents API — base64-per-file, paginated, 403-rate-limited, ETag-conditional), replacing `external-mock`'s flat scripted marketplace fixture.
- **Backing e2e:** (attribution targets) `admin-marketplace-install`

> One-time setup: on the prod stack claim owner → drop the `MARKETPLACE_*` mock overrides so `marketplace.search` / `install` hit real `api.github.com` → open admin/connectors (or the marketplace surface) → search → install.

## Sub-items

### F1 — `marketplace.search` against real GitHub
- **Steps:** admin marketplace → search a real term → the backend queries the real GitHub Contents API and lists candidate skill repos.
- **Expected:** real repos surface; the client handles **base64-per-file content, pagination, ETag-conditional requests, and a 403 rate-limit** gracefully (friendly message, not a crash).
- **⚠️ mock gap:** the mock is **flat / un-paginated / un-rate-limited**; real GitHub Contents is **base64-per-file, paginated, 403-rate-limited, ETag-conditional**, and a real `SKILL.md` can be **malformed or oversized** — none of which the mock reproduces.
- **Backing test:** `admin-marketplace-install.spec.ts` (`searchGitHub` helper)
- **Result:** ⬜

### F2 — Install a real skill (SKILL.md fetched + parsed)
- **Steps:** pick a real GitHub skill from the search results → install → the backend fetches its `SKILL.md` → parses it into a real installed skill.
- **Expected:** `201`; the installed skill carries `source = 'marketplace'`; a malformed/oversized `SKILL.md` yields a friendly error, not a crash.
- **Backing test:** `admin-marketplace-install.spec.ts` (`install a github skill → SKILL.md fetched + parsed into a real skill`)
- **Result:** ⬜

### F3 — SkillsMP 🚫 de-scoped (permanent fiction)
- **Steps:** none.
- **Expected:** n/a.
- **⚠️ note:** `skillsmp.json` is hand-rolled and **`api.skillsmp.com` does not exist** — this source can never be verified against reality. **Flag it, don't chase it.** 🚫 **de-scoped.**
- **Backing test:** no backing spec (gap) — de-scoped
- **Result:** 🚫 de-scoped

## Findings
(record here during the manual phase; also log `../findings.md`, ID `F-F-n`)
