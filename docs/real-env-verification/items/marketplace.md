# marketplace — Marketplace: real GitHub search + install

- **Status:** 🟡 inconclusive first pass — re-verify with a matching query
- **Module:** `marketplace.search` queries the real GitHub Contents API and lists candidate skill repos; installing fetches + parses a real `SKILL.md`; base64-per-file / pagination / ETag / 403-rate-limit / malformed SKILL.md all degrade gracefully.
- **Surface:** admin/connectors (or the marketplace surface) → search → install.
- **Real dep:** real `api.github.com` (Contents API — unauthenticated works; optional `GITHUB_TOKEN` to raise the 60/hr limit).
- **Backing e2e:** `admin-marketplace-install`.

## Checks

### 1 — `marketplace.search` against real GitHub  (was §F1)
- **Steps:** admin marketplace → search a real term → the backend queries the real GitHub Contents API and lists candidate skill repos.
- **Expected:** real repos surface; the client handles **base64-per-file content, pagination, ETag-conditional requests, and a 403 rate-limit** gracefully (friendly message, not a crash).
- **⚠️ mock gap:** the mock is **flat / un-paginated / un-rate-limited**; real GitHub Contents is base64-per-file, paginated, 403-rate-limited, ETag-conditional, and a real `SKILL.md` can be malformed/oversized — none of which the mock reproduces.
- **Backing test:** `admin-marketplace-install.spec.ts` (`searchGitHub` helper)
- **Result:** 🟡 (first pass returned `[]` — no GitHub call visible in logs; needs a query with known matches)

### 2 — Install a real skill (SKILL.md fetched + parsed)  (was §F2)
- **Steps:** pick a real GitHub skill from the results → install → the backend fetches its `SKILL.md` → parses it into a real installed skill.
- **Expected:** `201`; the installed skill carries `source = 'marketplace'`; a malformed/oversized `SKILL.md` yields a friendly error, not a crash.
- **Backing test:** `admin-marketplace-install.spec.ts`
- **Result:** ⬜

### 3 — SkillsMP 🚫 de-scoped (permanent fiction)  (was §F3)
- **Note:** `skillsmp.json` is hand-rolled and **`api.skillsmp.com` does not exist** — this source can never be verified against reality. Flag it, don't chase it.
- **Result:** 🚫 de-scoped

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Search **results render** (not silently empty on a real match); the install button fires and the installed skill appears; a 403/malformed case shows a friendly message.

## Findings
(record here; also log `../findings.md`, ID `F-F-n` historical anchor)

- Note the manual-install path also exists (paste a SKILL.md directly — commit ba54876).
