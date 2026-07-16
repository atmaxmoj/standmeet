# resume-draft — Jobs: resume curation + ranking (real model)

- **Status:** ⚪ **N/A — real dep absent, verified not assumed** (2026-07-15). The owner-MCP surface itself is GREEN and was driven end-to-end through the **real client**: 125 tools, `jobs.register_source` + `jobs.fetch_new` → **158 live GitLab jobs off the real Greenhouse API**, `jobs.show` → the real AI-Engineer JD. The blocker is **owner DATA, not the product**: the corpus holds no career history and `page.where.looking_for` is `[]`.
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
- **Result:** ⚪ **N/A — cannot be driven honestly on this owner's corpus.** Everything up to the curation step works on the real path: the real stdio client reaches `/mcp` (125 tools), a real Greenhouse fetch put **158 live GitLab jobs** in the 1d pool, and `jobs.show` returns the real JD. **The architecture also reframes the check:** `resume.draft` **requires `resume_content` from the caller** ("resume_content is required") — per CLAUDE.md, StandMeet is the *deterministic state holder* (fetch/dedup/persist/PDF/QR/code-issue) and **Claude is the reasoning half** that authors the resume. So "the real model curates" means the OWNER'S AI curates; there is no StandMeet-side curation to test, and the item's ⚠️ mock-gap note (`sampleResumeContent` hand-authors it) describes what a real owner's client would also do. **Why it stops here:** curating a resume needs career material, and this owner's vault has none — grep over the whole real corpus: **0** "worked at" / "years of experience" / "employment" / "my role at" / "I led"; the tree is `cybernetics · math · optimization · software` (an ideas vault, not a CV; the 5 "resume" hits are StandMeet's own job-loop design docs). Authoring one anyway would mean **fabricating employment history** — exactly what this check's own bar forbids ("corpus-grounded … not a template") and what the product's anti-fabrication discipline (A11) refuses. Re-run when the owner's corpus carries real career material.

### 2 — Job ranking / recommendation  (was §A18)
- **Steps:** with a filled 1d Redis job pool, ask "what's worth applying to today" → the model ranks the pool using the corpus + `page.where.looking_for`.
- **Expected:** a sensible ranked shortlist with reasons tied to the owner's corpus and stated preferences.
- **⚠️ mock gap:** `integration-job-loop` covers fetch/dedup/discard only; the "Claude ranks the pool" step has no coverage.
- **Backing test:** `integration-job-loop.spec.ts:45` (fetch/QR loop, not ranking). Ranking → no backing spec (gap).
- **Result:** ⚪ **N/A — the check's own stated real dep is unset.** Ranking is defined as "the model ranks the pool using the corpus + `page.where.looking_for`", and `page.get` returns **`looking_for: []`** with the page still on placeholder defaults ("Edit your location in /admin/page." / "Tell visitors what you're up to right now."). The job pool half IS real and green (158 live GitLab jobs). Ranking against an empty preference set would measure nothing. Re-run once the owner fills `looking_for`.
- **Result:** ⬜

### 3 — `resume.draft` + `applications.commit` with a real job snapshot  (was §E6)
- **Steps:** pick a real fetched job (`cache_id`) → `resume.draft(cache_id, resume_content)` → preview the staging draft → hand to [[application-commit]].
- **Expected:** the job snapshot persists into the application row while the cache row stays 1d-TTL ephemeral.
- **Backing test:** `resume-draft-preview.spec.ts` · `applications-commit.spec.ts` · `job-fetch-ttl-eviction.spec.ts`
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The staging draft renders the tailored resume (not the sample fixture, not empty); the owner can eyeball before committing.

## Findings
(record here; also log `../findings.md`, ID `F-A-n` / `F-E-n` historical anchor)
