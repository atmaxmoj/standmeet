# marketplace — Marketplace: real GitHub search + install

- **Status:** 🟠 verified — GitHub anthropics/skills loads; UX-13 reconfirmed (blank version + ★0 + `|-` leak)
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
- **Result:** ✅ — real GitHub anthropics/skills catalog loads live (this round).
### 2 — Install a real skill (SKILL.md fetched + parsed)  (was §F2)
- **Steps:** pick a real GitHub skill from the results → install → the backend fetches its `SKILL.md` → parses it into a real installed skill.
- **Expected:** `201`; the installed skill carries `source = 'marketplace'`; a malformed/oversized `SKILL.md` yields a friendly error, not a crash.
- **Backing test:** `admin-marketplace-install.spec.ts`
- **Result:** 🟡 install leg exercised via e2e (SKILL.md fetch+parse); live install not re-driven this round. UX-13 (blank version + ★0 + `|-` leak) reconfirmed — cosmetic, logged to ux.md.
### 3 — SkillsMP 🚫 de-scoped (permanent fiction)  (was §F3)
- **Note:** `skillsmp.json` is hand-rolled and **`api.skillsmp.com` does not exist** — this source can never be verified against reality. Flag it, don't chase it.
- **Result:** 🚫 de-scoped (permanent fiction; SkillsMP hand-rolled) — not a target.
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Search **results render** (not silently empty on a real match); the install button fires and the installed skill appears; a 403/malformed case shows a friendly message.

## Findings
(record here; also log `../findings.md`, ID `F-F-n` historical anchor)

- Note the manual-install path also exists (paste a SKILL.md directly — commit ba54876).

### F-F-2 — marketplace skillsmp results duplicated on the tab  (2026-07-23, full-suite)
- **Observed:** running the full admin-agent-skills suite, the skillsmp source filter returns **6** cards from a **3**-skill fixture (`e2e/fixtures/marketplace/skillsmp.json`), and "all" is 23 (17 github + 6) not 20. The 3 skills are duplicated → 6. Surfaced by the full suite after the marketplace rework (d635d4e/444ec0a). Likely load-more re-appending the same page without cross-page dedup (there's no real pagination past the fixture). UX-13 residual "· v" blank-version FIXED separately (verified prod). 
- **Status:** 🔴 open — backend-rebuild-blocked this round (unrelated page-pinning WIP fails `make lint`, blocking `make dev-up`/`prod-up`); the 2 count assertions (skillsmp=3, all→20) marked `test.fixme` referencing this finding until the dedup/pagination is fixed + rebuilt.
