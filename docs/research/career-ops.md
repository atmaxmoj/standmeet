# career-ops — what StandMeet can borrow

Read 2026-10-03 at career-ops `c1d0d1f` (github.com/career-ops-hq/career-ops, ~1,750 files, a
local-first CLI job-search system: markdown/TSV files as the store, ~200 node scripts, agent
instructions in `modes/`). Four slices were read in parallel against StandMeet's code; the claims
below that decide priority were spot-checked in our code.

## The one-line verdict

career-ops is strongest where StandMeet is thinnest: **after the application is sent** (status,
follow-up, funnel) and **mechanical fact checks on a tailored résumé**. StandMeet is already stronger
on sandboxed plugins, one database instead of locked files, and one thing career-ops can only guess
at: each application has its own access code, so we *know* when a recruiter opened the résumé QR
and what they asked.

## Borrow — ranked by value for effort

### A. After applying (biggest gap)

1. **Recruiter engagement as a status the system sets.** A first conversation on an application's
   code marks the application "opened" with a time (via `GetByAccessCode` on
   `conversation.started`). A page view cannot yet: `visit_event.code_id` is empty on every
   recruiter path, because the beacon carries the code only inside the reported page URL. Show "QR opened 2 days after submit · 3 questions" on the row.
   Today `applications.status` is written once at commit and never again (verified:
   `db/queries/jobs/applications.sql` has no update). Small–medium.
2. **Owner-set outcome + transition ledger** (career-ops `set-status.mjs`, `data/status-log.tsv`,
   `templates/states.yml`): responded / interview / offer / rejected / withdrawn / hired as a second
   axis, `applications.update_status`, every change a ledger row (from, to, source, note).
   Withdrawn revokes the code (already specified, `docs/design/job-loop.md` withdraw cascade, never
   built). Small.
3. **Interview prep from the recruiter's real questions** (career-ops `modes/interview-prep.md`
   guesses from the JD): we have what the company actually asked the owner's AI under that code,
   and which questions found no answer in the corpus. A prep pack = their questions + the corpus
   gaps they exposed. The strongest idea StandMeet alone can do. Medium.
4. **Follow-up cadence driven by engagement** (career-ops `followup-cadence.mjs`: 7d then 7d, max
   2, then cold): nudge only when the code was never opened; when it was, the draft cites what they
   asked. A "next nudge" date column, not a cron. Medium.
5. **Honest funnel** (`funnel-stages.mjs`, `funnel-velocity.mjs`): highest stage reached, median
   days per step, waiting rows reported as excluded, no claims below n=20 — plus the step only we
   can measure: submitted → code opened. Small once 1–2 exist.

### B. Résumé facts (owner's hard rules become mechanical)

6. **Draft-vs-master structural check** in `resume.update_draft` and `applications.commit`
   (career-ops `cv-title-check.mjs`, `cv-experience-order.mjs`): pair each work entry with the
   master's by company + dates; a changed title or date, or works not newest-first, blocks unless
   the owner overrides. ~1 day + e2e.
7. **Numeric-claim lint, warn-only, in the `update_draft` receipt** (career-ops
   `verify-cv-facts.mjs` `metricClaims()` and its exclusions — years, plan horizons): every number
   in the draft not found in the master or corpus is listed as "unsupported". 1–2 days.
8. **Store form answers on the application** (career-ops `application-answers.mjs`,
   `modes/apply.md`): `{question, answer, field_type, state}`; later forms reuse them and the
   recruiter-side AI stays consistent with what was sent. ~1 day.
9. Skill edits, no code (resume-tailoring / job-cover-microsite): the `apply.md` form contract
   (authorization / salary / demographic fields always need the owner's confirmation; limits read
   from the field's maxlength; re-sweep required fields until stable; answers come from the
   committed draft), an optional fresh-subagent hiring-manager audit (`modes/pdf/hm-audit.md`),
   and a 4-question gate before a cover letter (`modes/cover.md`).

### C. Discovery

10. **One persistent "seen" ledger across sources, written by `jobs.discard` too.** Same-source
    repeats are already blocked (`job_fingerprints`, written at fetch time, keyed
    `(source_id, external_id)`); cross-source dedup lives only in memory, so yesterday's job returns
    through another source, and a discarded job (today a Redis `DEL`) returns the same way. A new
    owner-scoped ledger on the dedup keys (canonical URL, company::title::location), not hanging off
    `job_sources`. Job Scout's hand-kept `reported.jsonl` becomes a product fact. Small–medium.
11. **Posting-age cutoff on `PublishedAt`** (career-ops `scan.mjs --since`): `since_hours` today
    windows the pool by entry time (verified: `jobsuc/pool_window.go` → `Cache.ListWindow`), so a
    newly registered board's whole backlog arrives as "new". Undated postings pass. Small.
12. **Liveness before tailoring** (career-ops `liveness-api.mjs`, API rung only): Greenhouse/Lever
    404 = closed; Ashby = still on the board; anything ambiguous = "unknown", never "expired".
    Checked before `resume.draft` / `applications.commit`. Medium.
13. **Probe a board at `register_source`** (`discover-ats.mjs`, `verify-portals.mjs`): posting
    count + three sample titles; "live but empty" ≠ "not found". Small–medium.
14. **Country-eligibility phrases as data** (`scan.mjs` `buildCountryEligibilityFilter`): moves
    Job Scout's "US-only" judgement into deterministic code, flagged not dropped. Small.

### D. Platform

15. **Untrusted-content fencing** (career-ops AGENTS.md "Untrusted External Content" +
    `validate-untrusted-content-coverage.mjs`): one STE rule in the MCP `ServerInstructions`; JD
    bodies from `jobs.show` (today returned raw; `fetch_new` returns no body) and third-party text in
    block output wrapped in `<untrusted source=…>`; the snapshot's title and company in the
    recruiter's briefing (`recruiterBriefing`) fenced too. No shared fence exists today
    (`instructionWithPageText` is unexported and system-prompt only). An e2e with an "ignore
    previous instructions" JD. ~0.5 day.
16. **A "ready for X" doctor** (`doctor.mjs --json`): one MCP tool listing what is missing for a
    workflow (no wiki, no handle, no `looking_for`, no provider, no résumé master); the
    instructions say to run it first. ~1 day.
17. **Ship the owner workflows with the instance**: resume-tailoring / job-description-reading /
    job-cover-microsite live only in the owner's `~/.claude/skills`; serve them as MCP prompts or
    a guide tool (as `microsite.guide` does), versioned with the instance. Not as StandMeet skills:
    those reach only visitor agents, so the recruiter would get the owner's private workflow. 1–2
    days.
18. **Pin marketplace blocks** (`plugins-registry` SHA pins, `plugins/_lock.mjs`): store npm
    `dist.integrity`, verify on load, re-consent on change. ~1 day.
19. **Generic upgrade gate** (`upgrade-tests.mjs --pr-gate`, `--canary`): seed the last release,
    upgrade to HEAD, owner data intact; a planted clobber must go red. 2–3 days.

## Second pass (2026-10-03): the parts the first pass did not read

The first pass read four slices. Owner: "这是所有你觉得能借鉴的么" — it was not. A second pass read
the remaining modes, `web/`, `providers/`, `dashboard/`, `evals/`, `tests/`, `lib/`, `templates/`
and `interview-prep/`. Claims about our code were spot-checked: we already have 18 fetch kinds
(`internal/owner/jobs/fetch/`), `fiber_resume.go` decodes with plain `json.Unmarshal`, `ashby.go`
reads no compensation, and `workday.go` walks pages with no retry.

### E. After applying, extended (build on A1–A5)

20. **Company history at `jobs.show`** (`company-history.mjs`): the owner's earlier applications to
    the same company (date, outcome, opened), and a repost count from the C10 ledger. Facts only,
    never "ghosted"; never changes a score. Small after A1/A2/C10.
21. **Cadence by outcome** (`modes/followup.md`, `rejection-latency.mjs`): responded / interview
    get their own nudge intervals; 30 days silent after an interview = a courtesy flag. The
    `outcome_changed` subscriber recomputes `next_followup_at`. Small.
22. **Rehearse the agent before a recruiter does** (`interview/practice.md`, reversed): the owner's
    AI asks the JD's likely questions to the owner's own agent under the hiring role, on a selftest
    code (never the application's code, or Phase 1 marks it opened). Ungrounded answers are gaps
    found before commit. Medium.
23. **"What the agent already told them"** (offer-prep consistency, `salary-gap --stated-for`): the
    Phase 2 read flags answers touching pay, availability, start date or work authorization; the
    prep pack and offer review quote them verbatim beside `job_snapshot`. Small on Phase 2.
24. **Gaps across all applications** (`upskill.mjs`): ungrounded recruiter questions counted over
    every application, grouped by the owner's AI — "what to write next". Small.
25. **Do-not-apply list** (oferta blacklist gate): a company mark on the C10 ledger; flagged at
    fetch, `resume.draft` asks for an override. Nothing adds a company automatically. Small.
26. **Interview debrief as raw corpus** (`interview-prep/sessions/`): after a real interview the
    owner's AI writes a raw item linked to the application, so prep and the agent match what the
    owner actually said. Owner-curated. Small.

### F. Sources

27. **Greenhouse application questions** (`web/src/lib/apply/greenhouse.ts`: `?questions=true`
    returns label, type, required, options; `name` = DOM id): `jobs.show` returns `questions[]`;
    Claude drafts answers before the form is opened. Feeds B8. High value, small.
28. **Salary only when the source states it** (`providers/ashby.mjs` `parseCompensation`: salary
    components only, annualized by the stated interval, no interval = unusable): optional
    `salary{min,max,currency}` on `FetchedJob`. Small.
29. **Aggregators store the employer's ATS URL** (`ADDING_A_PROVIDER.md` rule 2): only
    `himalayas.go` does today; without it C10's URL key cannot match across sources. Small.
30. **Adapter contract audit** (`ADDING_A_PROVIDER.md` §2): a missing container is a schema error
    (ours read `{}` as "0 jobs" forever); one bad row is dropped, not fatal; unparseable dates are
    missing, never 1970; bounded retry on 429/5xx with clamped `Retry-After` and a page delay
    (Workday walks 25 pages back to back). ~1 day.
31. **Cheap sources**: Getro and Consider (VC portfolio boards; one source = hundreds of
    startups, URLs point at the employer's ATS); Teamtailor needs only a hint (`/jobs.rss` on the
    `rss` kind); Personio, Breezy, Pinpoint small. Small each.
32. **Suggest direct sources** (`discover-new-companies.mjs`): companies seen on HN/RemoteOK/WWR
    with no registered ATS source, probed with C13 before registering. Small.
33. **Flag demo and scam postings, never drop** (`_trust-validator.mjs`): `flags[]` on
    `FetchedJob` (URL shortener, no apply URL, company ≠ domain). Small.

### G. Checks and tests

34. **PDF reading order** (`tests/cv-visual/pdf-reading-order.spec.mjs`): our PDF spec only checks
    `toContain`; assert extracted text order (name → works → education → skills) so the QR corner
    cannot scramble what an ATS reads. Small, high value.
35. **Every check has a must-not-flag fixture and cites its rule** (`templates/ats-rules.yml`): fold
    into B6/B7 (years, plan horizons, "2 years 11 months" must not fire).
36. **A check says what it could not read** (`fact-gate-language-coverage.test.mjs`): B7's receipt
    carries `coverage: full | partial(<reason>)`; a zh draft must not read as "0 unsupported".
37. **Reject unknown keys in `resume_content`** (`lib/cv-payload-schema.mjs`): `school` misnamed
    `institution` drops the section silently today. `DisallowUnknownFields`, error names the field.
    Trivial.
38. **Tool names in agent-facing text must resolve** (`agent-docs-script-refs.test.mjs`):
    `ServerInstructions`, `microsite.guide`, D17 guides. `upload_media` is the precedent. Lint.
39. **Golden labels per model in the eval harness** (`evals/`, `eval-golden.mjs`): a discrete
    outcome per scenario and an agreement table per model, so "can this cheaper provider hold the
    visitor role" has a number. Medium.
40. **Stable prompt prefix** (`batch-runner-prompt-cache-stability.test.mjs`): per-code text early
    in the system prompt breaks provider prefix caching. Unverified where `recruiterBriefing` sits;
    measure first. Medium.

### H. Workflow text only (D17 guides, no code)

- Retracting a claim edits or deletes the corpus entry it came from (vault first) — no separate
  retracted list; the agent repeats whatever the corpus holds. "Cannot confirm" is recorded next to
  the claim in the master and never upgraded by a rerun.
- offer-prep stance: describe, never judge; quote clauses verbatim; questions for a lawyer; the
  contract never goes into the instance.
- Email variants for a stuck process and for a no-show call; never write to accessibility,
  benefits or ethics mailboxes.
- JD checks: contractor-status wording, benefits terms from the wrong country, buzzwords on thin
  infrastructure; a cited jurisdiction table (statute, date, URL) with "silence proves nothing".
- Item 9 above (form contract, hiring-manager audit, cover-letter gate).

Read and not borrowed in the second pass (reasons in brief): `dashboard/` (terminal UI), web Apply
drive loop (owner's Playwright does it), title-fit bands and scoring matrices (Claude ranks),
`interview.md` (asks the owner to estimate metrics), redflag emoji scores, `contacto` (third-party
people), `regional/eu-swe` (built on work authorization), `batch/` (removes the owner from the
loop), `scaffolder/`, extra plugin connectors (the owner's AI has those MCPs), screenshot baselines,
em-dash normalizer (rewrites the owner's text), résumé templates (second home), community docs,
government/HTML-scraped providers (markets the owner does not target).

## Reconsidered: borrow the idea, not the mechanism (owner, 2026-10-03: "有的我看还挺好的")

- **Markdown files as the store** → a one-way export of applications (job snapshot, résumé, outcome
  ledger, the recruiter's questions) into the owner's vault as markdown. The database stays the
  only home; the export is a readable copy the owner owns and can take away.
- **Pasted-email reply matching** → an owner-side workflow: the owner's AI reads the owner's own
  mailbox (Gmail connector), proposes "Vercel invited you to interview → outcome: interview", and
  calls `applications.update_outcome` only after the owner agrees. No fuzzy matching on the server;
  the instance never touches the mailbox. Recruiter mail is the main outcome signal the QR cannot
  see.
- **linkedin-join** → owner-side, on the owner's own exported `Connections.csv`: who at a target
  company could refer. The owner's data, read locally, never stored in the instance. (Server-side
  LinkedIn scraping and recruiter contact export stay out.)
- **rank-pipeline's score + reason** → `jobs.annotate(job, score, reason)`: the owner's AI judges,
  the instance stores it on the C10 seen-ledger row (a field on the pooled job would travel into
  the snapshot, but dies with the 1-day pool when no draft follows); it is copied into the
  application snapshot, never shown in a recruiter-visible read, and the funnel can later ask
  whether high scores get opened more.
- **Work-authorization answers** → nothing new to build; StandMeet already does it, better.
  Application codes assume the builtin `hiring` role (`jobsuc/seed.go`), which reads
  `subjectivity://cv` (employers, dates, work authorization) on top of what an invitee reads; the
  `invited` role deliberately does not, so gate-approval codes never get this PII. A recruiter who
  scanned the résumé QR asks the agent and gets the answer under ACL; the public page, other codes
  and the PDF never show it. Verified (`cv-reachable-only-under-the-hiring-role.spec.ts`), with two
  limits: a reused code keeps its own role, and only a top-level note titled `cv` matches the glob
  (`cvWarning` checks titles, not the derived path — to fix). The owner's AI reads the same note over MCP when filling a form. (A first
  draft proposed a private "form facts" store: a second home for the fact and a worse copy of the
  ACL. Owner: "这种完全可以利用现有机制…是不是这些都没有好好结合现有机制".)

## Do not borrow

- Markdown/TSV files as the store and everything that exists because of it (tracker locks, merge,
  normalize, sync-check, session-activity, PID locks). We have Postgres and one write path.
- Email paste + fuzzy reply matching (`reply-matcher`, `invite-match`): heavy guessing to recover a
  fact our codes give exactly. Later, if ever, as a Claude-side skill.
- LinkedIn joins, vCard contact export, server-side LinkedIn/Indeed liveness or Playwright page
  checks: third-party PII and outside the scraping boundary in `job-loop.md`.
- Ranking/scoring inside the server (`rank-pipeline`, `triage.md`, `classify-tier`): StandMeet holds
  state, Claude reasons.
- Anything that adds a second home for facts (`cv.md`, `article-digest.md`, `career-profile.yml`,
  `cv-facts.json` allowlists) or invites claims (`pdf.md` exit-narrative bridge, keyword-dense
  summaries, retitling "framing", cover letters where every claim needs a number).
- Work-authorization fields in a profile and immigration tables: the owner's rule keeps that out
  of every résumé.
- The 572-line AGENTS.md, per-CLI instruction copies, 19 translated mode sets, market benchmark
  tables, the terminal dashboard, community/marketing apparatus before there are users.
