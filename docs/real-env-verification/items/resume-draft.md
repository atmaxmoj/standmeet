# resume-draft — Jobs: resume curation + ranking (real model)

- **Module:** The real model ranks the day's job pool against the corpus and the owner's stated preferences, then curates raw, wiki and the job description into a tailored résumé and cover letter. The owner previews it in staging before anything is committed.
- **Surface:** Owner MCP (`resume.draft`, job ranking) → the staging preview → `/admin/drafts`.
- **Real dep:** A real model, a filled job pool (see [[job-fetch]] — the pool is 1-day TTL, so fetch first), and the owner's stated `looking_for`.
- **Backing e2e:** `resume-draft-preview` · `resume-draft-update` · `applications-commit` · `integration-job-loop`. Curation and ranking quality → `gap`.

## Checks

### 1 — The model curates the résumé, and a template does not ⭐
- **Steps:** Pick a real fetched job. Run `resume.draft` against its snapshot. Read the produced résumé and cover letter. Compare them against the owner's corpus and against the job description.
- **Expected:** The text is coherent, grounded in the corpus, and tailored to this job. Claims trace to real corpus content. Running it against a different job produces materially different text.
- **Mock gap:** The e2e fixture hand-authors the entire tailored résumé and cover letter, and the specs only assert that the fixture renders to PDF. The model's curation — the outbound loop's core reasoning step — is never exercised.
- **Backing test:** `resume-draft-preview.spec.ts` · `resume-draft-update.spec.ts` (both consume the fixture) · curation quality → `gap`

### 2 — The ranking reasons trace to the corpus and the stated preferences
- **Steps:** With a filled pool, ask which jobs are worth applying to. Read the shortlist and the reason given for each.
- **Expected:** The order is defensible and each reason names something real — a corpus topic or a stated preference — rather than restating the job title.
- **Mock gap:** `integration-job-loop` covers fetch, dedup and discard only. The ranking step has no coverage.
- **Backing test:** `gap`

### 3 — The snapshot persists while the pool row stays ephemeral
- **Steps:** Draft against a real `cache_id`. Commit it. Wait for the pool row to expire, or evict it. Read the application row.
- **Expected:** The application row still carries the job snapshot and the résumé content. The pool row is gone on its own TTL. The permanent record does not depend on the ephemeral one.
- **Backing test:** `resume-draft-preview.spec.ts` · `applications-commit.spec.ts` · `job-fetch-ttl-eviction.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The staging draft renders the tailored text, not a sample and not an empty frame.
The owner can read the whole thing before committing, because commit is the irreversible step.
Any figure shown beside the draft states what it measured — see [[resume-match-gauge]].
