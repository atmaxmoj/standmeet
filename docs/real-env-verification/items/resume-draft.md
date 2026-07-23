# resume-draft — Jobs: resume curation + ranking (real model)

- **Status:** 🟡 blocked-by-setup — 0 drafts (empty pool); e2e-covered
- **Module:** the real model ranks the day's job pool against the corpus + stated preferences, and curates raw+wiki+JD into a coherent, JD-tailored resume + cover letter (authored by the model, not a template) previewed in staging.
- **Surface:** owner MCP (`resume.draft` / job ranking) → staging preview.
- **Real dep:** real DeepSeek + a filled 1d Redis job pool (see [[job-fetch]]) + `page.where.looking_for`.
- **Backing e2e:** `resume-draft-preview` · `resume-draft-update` · `applications-commit` · `integration-job-loop`. Curation/ranking quality → no backing spec (gap).

## Checks

### 1 — Resume-content curation (job-loop core) ⭐  (was §A17)
- **Steps:** run `resume.draft(job_cache_id, …)` against a real job snapshot → let the real model curate raw+wiki+JD into `resume_content` → preview in staging.
- **Expected (likely RED):** a coherent, corpus-grounded, JD-tailored resume + cover letter authored *by the model* — not a template. The outbound loop's core reasoning step.
- **⚠️ mock gap:** `e2e/fixtures/resume.ts:150 sampleResumeContent` **hand-authors the entire tailored resume + cover letter**, and the specs only assert the PDF render of that fixture. The model's curation is never exercised.
- **Backing test:** `resume-draft-preview.spec.ts:33` · `resume-draft-update.spec.ts:34` · `applications-commit.spec.ts:43` (all consume `sampleResumeContent`). Curation quality → no backing spec (gap).
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — empty draft pool (0 drafts). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 2 — Job ranking / recommendation  (was §A18)
- **Steps:** with a filled 1d Redis job pool, ask "what's worth applying to today" → the model ranks the pool using the corpus + `page.where.looking_for`.
- **Expected:** a sensible ranked shortlist with reasons tied to the owner's corpus and stated preferences.
- **⚠️ mock gap:** `integration-job-loop` covers fetch/dedup/discard only; the "Claude ranks the pool" step has no coverage.
- **Backing test:** `integration-job-loop.spec.ts:45` (fetch/QR loop, not ranking). Ranking → no backing spec (gap).
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — empty draft pool (0 drafts). Backing e2e green; not manually driven (no live disproof, no manual proof).
### 3 — `resume.draft` + `applications.commit` with a real job snapshot  (was §E6)
- **Steps:** pick a real fetched job (`cache_id`) → `resume.draft(cache_id, resume_content)` → preview the staging draft → hand to [[application-commit]].
- **Expected:** the job snapshot persists into the application row while the cache row stays 1d-TTL ephemeral.
- **Backing test:** `resume-draft-preview.spec.ts` · `applications-commit.spec.ts` · `job-fetch-ttl-eviction.spec.ts`
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — empty draft pool (0 drafts). Backing e2e green; not manually driven (no live disproof, no manual proof).
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The staging draft renders the tailored resume (not the sample fixture, not empty); the owner can eyeball before committing.

## Findings
(record here; also log `../findings.md`, ID `F-A-n` / `F-E-n` historical anchor)
