# Job loop roadmap: epics, stories, specs

Status: PLAN (2026-10-03). Owner: "很乱，看不懂，能不能写好specs，什么大功能，epic，查成什么story，细分什么specs".
9 epics, 34 stories.
This file is the index. It replaces the A–H item lists in `docs/research/career-ops.md` as the
plan; the research note keeps the evidence (career-ops file, our code facts). Epic 1–3 detail lives
in `docs/design/job-loop-after-apply.md`. The per-spec design (files, approach, test) for every
epic, including 8 and 9, is in the artifact https://claude.ai/artifact/NrwuDSvrtw3mn7K6DxT18Z.

How to read it:

- **Epic** = one outcome the owner gets.
- **Story** = one thing the owner (or a recruiter) can do or see when it ships. Each story has a
  "done when" that can fail.
- **Spec** = one buildable change, small enough for one commit with its e2e test. `[ref]` points
  at the research-note item it came from.

Every spec is test-first: the e2e goes red on today's code, then green.

## Order

1. Epic 1 (sent applications are visible) — the base for 2 and 3.
2. Epic 7 story 7.1 (untrusted-content fence) — half a day, protects every later tool.
3. Story 4.1 (seen ledger) and Epic 8 (Job Scout writes into StandMeet).
4. Epic 5 (draft checks) and Epic 2 (interview prep) — in parallel.
5. Epic 3 (follow-up and funnel).
6. The rest of Epic 4, and Epic 6 (owner workflows).
7. The rest of Epic 7.
8. Epic 9 is skill text; it can run at any time. Its first inventory run needs the owner.

## Epic 8 — Job Scout writes into StandMeet

Job Scout reads StandMeet through a read-only API key and keeps its state in `~/JobScout/
reported.jsonl` and `reports/`. API keys can never reach owner-plane ops (the leak invariant in
`docs/design/facade-directions.md`), and Job Scout is the owner's own agent, so it moves to the
owner MCP with a key limited to a few tools.

- 8.1 Postings enter the 4.1 ledger; the server dedups. Specs: `jobs.record(postings[])` (batch
  upsert on `dedup.canonicalURL` / `compositeKey`, returns new or seen-on-date); one-time import of
  `reported.jsonl`.
- 8.2 Score, deductions, cited note, flags and interview reports stored: `jobs.annotate` widened;
  never in a recruiter-visible read.
- 8.3 History: `jobs.history` (shared pager) and an admin view by day beside `/admin/listings`.
- 8.4 A pick becomes a draft: `resume.draft` accepts `job_seen_id`; commit marks the row applied
  with `application_id`.
- 8.5 Least privilege: an optional per-key tool allowlist on owner MCP keys (today a key resolves
  only the owner id); `INSTRUCTIONS.md` steps 3 and 5 switch to `jobs.record` / `jobs.annotate`
  via `standmeet-mcp` spawned in device_bash.

## Epic 9 — Skills and job-search skills (skill text)

- 9.1 `skill-inventory`: `subjectivity/skills.md` in the vault is an index into dated evidence
  (cv, episode notes, operations-record), never a copy. Depth comes from the fact's own verb
  (studied < researched < used < built-with < designed/owned); years, last-used and depth are
  derived. It replaces the two drifting lists (the `resume.md` JSON skills array and cv's language
  list). Feeds resume-master step 6, resume-tailoring step 3 (alias → existing / supported / gap)
  and Job Scout deductions (absence scoped to "inventory as of date").
- 9.2 From ai-job-search (MadsLorentzen/ai-job-search): resume-tailoring gets a fresh-context
  reviewer, relevance-weighted cutting, tenure-vs-output handling and "expected <date>"; new skills
  `application-form-fields` and `application-outcome` (follow-ups max two, Gmail proposals in one
  batch, never proposes hired/declined); Job Scout stores gaps and vetoes per pick, flags degraded
  sources, adds people-search links only; job-description-reading notes aggregator copies drop
  grade and requisition id; resume-master lists source conflicts instead of picking; the PDF e2e
  (5.3.b) asserts ASCII-hyphen date ranges.

## Epic 1 — Sent applications are visible

After `applications.commit`, the owner sees what happened to each application without asking.

### Story 1.1 — I see when a recruiter opened my application (~1 day)

Done when: an untouched application shows nothing; the first page view with the code or the first
conversation shows "opened" with that time; a second conversation does not move it; monitoring off
still shows the conversation.

- 1.1.a Monitor reads `code` from the page URL the beacon reports when the request carries none.
- 1.1.b The applications list and detail derive `opened_at` (earlier of first non-bot visit and
  first conversation with the `code_id`) and the question count.
- 1.1.c The admin row shows "opened · N days after commit · M questions". [A1]

### Story 1.2 — I get an IM message the first time a recruiter chats (~0.5 day)

Done when: one notify rule on `application.engaged` delivers exactly one readable card per
application, and a webhook receives it exactly once even when the bus redelivers.

- 1.2.a Jobs plugin `Subscriptions()`; handler on `conversation.started` skips empty `code_id`.
- 1.2.b `engaged_at` guarded update + `application.engaged` in one transaction.
- 1.2.c `cardFacts` branch for `application.*`: company, role, code, admin link.
- 1.2.d New types are `Exposure: Webhook`, `Filterable: [code_id]`, in `inventoryWebhookTypes` and
  `webhook-event-types.spec.ts`. [A1]

### Story 1.3 — I record what happened (~1 day)

Done when: setting interview then offer leaves two ledger rows and the detail timeline shows both;
the list shows the outcome pill.

- 1.3.a `outcome` column + `application_outcomes` ledger (`-- events:` comment).
- 1.3.b `applications.update_outcome(id, outcome, note)`: MCP op + admin route, one transaction,
  records `application.outcome_changed`.
- 1.3.c `withdrawn` moves from the submission axis to the outcome axis; existing rows migrate.
- 1.3.d Admin pill + `timelineFor` ledger rows. [A2]

### Story 1.4 — Withdrawing takes the code back (~0.5 day)

Done when: after withdraw, the recruiter's next turn is refused and a new QR scan gets
`code_revoked`.

- 1.4.a A subscription on `outcome_changed` (to `withdrawn`) calls `RevokeCode`.
- 1.4.b `update_outcome` receipt lists embeds and microsites bound to the code.
- 1.4.c Fix the stale `codes.revoke` description. [A2]

### Story 1.5 — I see my history with a company when I look at a job (~0.5 day, after 4.1)

Done when: `jobs.show` for a company I applied to before lists that application's date, outcome
and opened mark; a company I never applied to shows nothing.

- 1.5.a `jobs.show` / `resume.draft` return earlier applications to the same company.
- 1.5.b Repost count from the seen ledger (same company + title, different URL, seen > N days
  apart). Facts only. [E20]

## Epic 2 — Interview prep from the recruiter's real questions

### Story 2.1 — I see what they asked and what my corpus could not answer (~1 day)

Done when: of two scripted answers, one that read an entry and one that used nothing, only the
second is marked as a gap.

- 2.1.a `conversation/facade` read by `code_id` with messages, citations, grounding, tool calls.
- 2.1.b `applications.engagement(id)` with `grounded` = cited id or grounded subjectivity or a
  search/grep hit.
- 2.1.c Admin detail "their questions" with gaps marked. [A3]

### Story 2.2 — My AI builds a prep pack and steers their next visit (workflow, after 6.1)

Done when: the `interview-prep` guide is served by the instance and names only tools that exist.

- 2.2.a `interview-prep` guide text: group by theme, a story per question, gaps to fill (vault
  first, then `corpus_create`), then `codes_set_waypoints`. [A3]

### Story 2.3 — I know what the agent already told them (~0.5 day)

Done when: an answer that mentioned pay, start date, availability or work authorization is quoted
verbatim in the engagement read, beside the posting's figure.

- 2.3.a Engagement read flags those answers; the prep pack quotes them. [E23]

### Story 2.4 — I rehearse before a recruiter comes (~1 day)

Done when: a rehearsal on a selftest code reports ungrounded answers and does not mark any
application opened.

- 2.4.a Rehearsal guide: the JD's likely questions asked to the owner's agent under the hiring role
  on a selftest code.
- 2.4.b Strong spoken answers become raw corpus through the owner's AI. [E22]

### Story 2.5 — I know what to write next (~0.5 day)

Done when: gaps from all applications are listed with counts; an application with no gaps adds
nothing.

- 2.5.a `applications.gaps()` across applications.
- 2.5.b Debrief guide: after an interview, a raw item linked to the application. [E24, E26]

## Epic 3 — Follow-up and the funnel

### Story 3.1 — I am reminded to follow up, once (~1 day)

Done when: a backdated unopened application is announced once across two job runs; an opened one
is never nudged blind; after two nudges it is "cold".

- 3.1.a `next_followup_at` set at commit; periodic job records `application.followup_due` and moves
  the marker in one transaction.
- 3.1.b Cadence by outcome (responded / interview / silent 30 days after interview).
- 3.1.c `applications.followups_due()` + admin "follow-up due". [A4, E21]

### Story 3.2 — I see an honest funnel (~1 day)

Done when: below 20 rows no median is shown; a rejection after an interview still counts the
interview.

- 3.2.a `applications.funnel()` from the ledger, waiting rows reported as excluded. [A5]

## Epic 4 — Find jobs worth applying to

### Story 4.1 — A job I saw or discarded does not come back (~1.5 days)

Done when: a job discarded from source A does not return through source B the next day.

- 4.1.a Owner-scoped seen ledger keyed on canonical URL and company::title::location, written at
  fetch, filtered before pooling.
- 4.1.b Aggregators store the employer's ATS URL.
- 4.1.c `jobs.discard` marks the ledger row.
- 4.1.d `jobs.annotate(score, reason)` on the same row; copied into the snapshot; never in a
  recruiter-visible read.
- 4.1.e Do-not-apply company mark: flagged at fetch, `resume.draft` asks for an override.
  [C10, F29, E25, reconsidered: rank score]

### Story 4.2 — I see only fresh, real postings (~1.5 days)

Done when: a new board's year-old backlog is not "new"; a closed Greenhouse job reads "closed"
before drafting; a URL-shortener posting is flagged, not dropped.

- 4.2.a Posting-age cutoff on `PublishedAt`; undated passes.
- 4.2.b Liveness API check before `resume.draft` (unknown ≠ expired).
- 4.2.c `flags[]` for demo/scam signals.
- 4.2.d Country-eligibility phrases flagged. [C11, C12, F33, C14]

### Story 4.3 — My sources are many and reliable (~2 days + per source)

Done when: a board returning `{}` reports a schema error, not 0 jobs; a 429 on page 5 of Workday
retries and keeps pages 1–4; registering a wrong slug says "not found" at once.

- 4.3.a Adapter contract audit: empty vs broken, bad row dropped, no 1970 dates, bounded retry.
- 4.3.b Probe at `register_source`: count + three sample titles.
- 4.3.c New sources: Getro, Consider, Teamtailor hint, then Personio / Breezy / Pinpoint.
- 4.3.d Suggest direct sources from companies seen on aggregators.
- 4.3.e `salary{min,max,currency}` only when the source states it. [F30, C13, F31, F32, F28]

## Epic 5 — The server checks what the AI wrote into a draft

The server does not write or change résumé content; it stores and renders what the owner's AI
sends. Today nothing checks that content: the rules live only in the resume-tailoring skill text,
and every past mistake was the AI's, caught by the owner reading — "Canadian PR" twice, "Nearly
three years" for 2 years 11 months, an unscoped "never ran multi-node HA". This epic makes the
server catch that class of mistake before commit.

### Story 5.1 — A draft cannot change my titles, dates or order, or state my immigration status (~1 day)

Done when: a changed title blocks commit unless overridden; a draft mentioning permanent residence,
citizenship, visa or work permit blocks commit; "2 years 11 months" and plan years do not fire.

- 5.1.a Draft-vs-master structural check in `update_draft` and `commit`, with must-not-flag
  fixtures. [B6, G35]
- 5.1.b Immigration / work-authorization terms in a draft block commit (en + zh terms).

Design:

- One pure function in `jobsmodel`: `CheckDraft(master, draft *ResumeContent) []Finding`, where
  `Finding{Key, Kind, Master, Draft}` and `Key` names the field (`works[1].title`, `identity.phone`,
  `summary`).
- Reference = the draft's `BasedOnMasterID` master, read **now** (a fact fixed in the master after
  the draft was made shows up as a finding); else the default master; else no reference, and the
  receipt says `coverage: none`.
- Pairing: a draft work pairs with the master work of the same company and start month; failing
  that, the same start month. Education pairs on school.
- Findings: a paired work's title, company or period differs; a draft work with no master pair; works
  or educations not newest-first; identity name, email or phone differs; an immigration term in any
  text field (summary, cover letter, bullets, custom, skills).
- Not findings: dropped works, reordered or rewritten bullets, a changed summary (other than an
  immigration term), skills chosen. Must-not-flag fixtures: "pull request (PR)", a dropped work,
  rewritten bullets.
- `update_draft`, the admin save and `resume.draft` return the findings in the receipt and never
  refuse: the owner is still editing.
- `applications.commit` refuses while any finding is unaccepted. It takes `accept: [key…]`, so
  every deviation is approved by name; a blanket override does not exist. The refusal names each
  field with the master value and the draft value. The admin composer shows the same list with one
  confirm box per finding before its commit button works.

### Story 5.2 — I am warned about numbers with no source (~1.5 days)

Done when: an invented number is listed as unsupported; a zh draft reports `coverage: partial`
rather than "0 unsupported".

- 5.2.a Numeric-claim warnings in the `update_draft` receipt, with coverage. [B7, G36]

### Story 5.3 — The PDF an ATS reads is complete and in order (~0.5 day)

Done when: a misnamed `resume_content` key is refused with its name; extracted PDF text runs name →
works → education → skills.

- 5.3.a `DisallowUnknownFields` on résumé ops.
- 5.3.b PDF reading-order e2e. [G37, G34]

### Story 5.4 — Application forms are answered from what I already said (~1.5 days)

Done when: a Greenhouse job returns its questions; an answer stored on one application is offered
for the same question on the next; authorization/salary/demographic answers always need my
confirmation.

- 5.4.a `jobs.show` returns Greenhouse `questions[]`.
- 5.4.b Stored form answers on the application. [F27, B8]

## Epic 6 — My AI gets the workflows from the instance

### Story 6.1 — Workflows ship and upgrade with the instance (~1.5 days)

Done when: a fresh owner MCP session can read resume-tailoring, job-description-reading and
interview-prep from the instance; a guide naming a missing tool fails lint.

- 6.1.a Embedded-markdown guide op (as `microsite.guide`), named in `ServerInstructions`.
- 6.1.b Lint: tool names in agent-facing text resolve. [D17, G38]

### Story 6.2 — The workflow texts (text only)

- 6.2.a Form contract, hiring-manager audit, cover-letter gate. [B9]
- 6.2.b Retract a claim at its source; "cannot confirm" never upgrades.
- 6.2.c Offer review: describe, quote, never judge; the contract stays out of the instance.
- 6.2.d Stuck-process and no-show emails; never write to accessibility/benefits/ethics inboxes.
- 6.2.e JD checks: contractor wording, wrong-country benefits, cited jurisdiction table.
- 6.2.f Recruiter replies from my Gmail → proposed outcome → I confirm. [reconsidered]
- 6.2.g Warm intros from my own `Connections.csv`, locally. [reconsidered] [H]

### Story 6.3 — One call tells me what is missing (~1 day)

Done when: an instance without a `cv` note, a master or `looking_for` lists exactly those.

- 6.3.a Doctor op. [D16]

## Epic 7 — Platform safety and quality

### Story 7.1 — A job posting cannot instruct my agents (~0.5 day)

Done when: a JD saying "ignore previous instructions" is fenced in `jobs.show` and in the
recruiter's briefing, and the agent does not follow it.

- 7.1.a One exported fence function; `jobs.show` bodies; `recruiterBriefing` title and company. [D15]

### Story 7.2 — Installed blocks are the ones I approved (~1 day)

- 7.2.a Store npm `dist.integrity`, verify on load, re-consent on change. [D18]

### Story 7.3 — An upgrade never loses my data (~2–3 days)

- 7.3.a Seed the last release, upgrade to HEAD, planted clobber goes red. [D19]

### Story 7.4 — I know which model can hold the visitor role (~2 days)

- 7.4.a Discrete outcome labels per eval scenario, agreement table per model.
- 7.4.b Measure the system-prompt prefix across codes; move per-code text last if it breaks
  caching. [G39, G40]

### Story 7.5 — My applications are mine, as files (~1 day)

- 7.5.a One-way markdown export of applications into the vault. [reconsidered]
