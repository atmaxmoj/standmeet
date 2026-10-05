# Job loop, after the application is sent

Status: PLAN (2026-10-03). Owner: "那我们来计划一下看看怎么做吧" after the career-ops review
(`docs/research/career-ops.md`, items A1–A5). This document plans A1–A5; B/C/D stay in the research
note as a backlog with a suggested order at the end.

Revision 2 (same day): every mechanism the plan reuses was read in the code (owner: "你把那些我们想要
整合的功能都读读"). The "Verified against the code" section lists what held and what did not; the
phases below already use the corrected facts.

## Where we are

- `applications` (`backend/db/schema.sql:1080`): one row per commit, `status` written once
  (`pending`) and never updated — `db/queries/jobs/applications.sql` has no update. The only event
  is `application.committed` (`jobsuc/application_events.go`). The withdraw cascade in
  `job-loop.md:387` was never built.
- The admin applications page (`app/src/lib/admin/applications-model.ts`) refuses invented progress
  ("opened 6 hours later / recruiter replied" was F-E-3). Everything below is a recorded fact or an
  owner's choice. Nothing is inferred.
- The résumé QR opens `<public_url>/?code=<code>` (`jobsuc/applications.go:324`).
- Facts we already hold, per application, through its access code:
  - conversations under the code (`conversations.code_id`), each message with its citations
    (`cited_*_ids`, `grounded_subjectivity_ids`, `tool_calls`);
  - `conversation.started` on the event bus, data `code_id` (always present; `""` without a code).
- A fact we do **not** hold: a page view with the code. The page-view beacon (`/api/v1/t`) sends
  the page URL in its body, and the monitor middleware reads a code only from the API request's own
  `?code=` or `Authorization` header — so `visit_event.code_id` is empty on every recruiter path.

## Done means (each can fail)

1. A committed application whose code was never used shows no "opened" mark, no question count,
   and no derived dates — with monitoring on or off.
2. The first page view carrying the code (monitoring on, consent given), or the first conversation
   under it, shows "opened" with that exact time; a second conversation does not move it.
3. An owner-set outcome is stored with a ledger row (from, to, note, time); "withdrawn" revokes the
   code: the recruiter's next turn and a fresh QR scan are both refused.
4. The recruiter's questions are listed in order, and each one whose answer used no corpus entry is
   marked as a corpus gap.
5. A follow-up is due only from recorded facts (commit time, opened or not) and is announced once
   per due date; a funnel figure is not shown below its sample floor.

## Phase 1 — opened, and the outcome axis (A1 + A2)

**Page views carry the code (monitor fix).** When a `visit_event` has no `code_id`, the monitor
reads `code` from the page URL the beacon reported and resolves it like the middleware does
(active codes only). Small, and it fixes a gap that exists today for every code, not only
applications. Bots: Slack/LinkedIn/Teams unfurlers are named in `monitor/entity/detect.go`, but
unfurlers do not run JS, so they never fire the beacon; Gmail and Outlook link scanners are not
detected and need no handling for the same reason.

**Opened (derived, no new column).** `opened_at` = the earlier of the first non-bot `visit_event`
with the application's `code_id` and the first conversation with that `code_id`. Read in the
applications list and detail queries. A recruiter who declines the cookie consent and never asks
anything stays invisible; "opened" is a lower bound and the UI says nothing in that case.

**Engaged event.** The jobs plugin gains `Subscriptions()` (one line in `wire/periodic.go`
`collectSubscriptions`, modelled on `subscriber/microsite.go`). The handler on
`conversation.started` skips an empty `code_id`, finds the application with `GetByAccessCode`, and
in one transaction runs `UPDATE applications SET engaged_at = $t WHERE id = $1 AND engaged_at IS
NULL` and, only when a row changed, records `application.engaged` (subject `application/<id>`, data
`{application_id, code_id, conversation_id}`). The bus delivers at least once; the guarded update is
what makes "first only" true for webhooks too (a `first_only` notify rule alone would hide a
duplicate from IM but not from webhooks). `engaged_at` is the guard, not a second home for
"opened": the list still derives `opened_at` as above.

**Outcome axis + ledger.** Keep `status` as the submission axis (pending / submitted / failed).
`withdrawn` leaves it (it is the owner's decision, not a submission result): remove it from
`SUBMISSION_STATES`, `STATE_BY_WIRE`, the tone map and the `jobsmodel` comment, and migrate any
existing `status='withdrawn'` row to `outcome='withdrawn'`. Add:

```sql
ALTER TABLE applications ADD COLUMN outcome text NOT NULL DEFAULT 'none'
  CHECK (outcome IN ('none','responded','interview','offer','rejected','hired','withdrawn'));
ALTER TABLE applications ADD COLUMN engaged_at timestamptz;
-- events: none (each row is announced by application.outcome_changed)
CREATE TABLE application_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  from_outcome text NOT NULL, to_outcome text NOT NULL, note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- One write path: `applications.update_outcome(id, outcome, note)` (MCP op + admin route). It
  updates the column, appends the ledger row and records `application.outcome_changed` in one
  transaction.
- Withdraw → revoke. `RevokeCode` runs its own access transaction and then purges the code's Redis
  visitor sessions, so it cannot share the outcome transaction. A jobs subscription on
  `application.outcome_changed` with `to = withdrawn` calls the access facade `RevokeCode`; revoking
  an already-revoked code is a no-op, so a redelivery is harmless. The revoke also cuts any embed or
  microsite bound to that code; `update_outcome` returns that list in its receipt when it is not
  empty.
- The three new types are declared in `jobsuc` with `Exposure: events.Webhook` and
  `Filterable: ["code_id"]` (the only key the notify-rule form can filter by today), added to
  `inventoryWebhookTypes` and to `e2e/test/webhook-event-types.spec.ts`.
- `wire/notify.go` `cardFacts` gains a branch for `application.*`: `{company}`, `{role}`, `{code}`
  and a link to the application in admin. Without it the IM card reads
  `application.engaged · application/<uuid>`.
- The admin row shows the outcome pill (owner's word) next to `StatusPill`, and "opened · 2 days
  after commit · 3 questions" in the meta line; the detail view's `timelineFor` adds the ledger
  rows. No other steps.
- Fix on the way: the `codes.revoke` op description still says "Existing sessions keep their frozen
  snapshot"; since the Redis purge they do not.

**Tests first (e2e, red before):**
`applications-engagement.spec.ts` — commit → untouched row shows nothing → recruiter opens
`/?code=` (monitoring on, consent given) → row shows opened at the page view → recruiter asks one
question → 1 question, opened time unchanged; a second conversation keeps it →
`application.engaged` reaches a webhook receiver exactly once. Monitoring off → opened comes from
the conversation. `applications-outcome.spec.ts` — owner sets interview then offer: two ledger rows;
withdraw → the recruiter's next turn is refused and a new session with the code gets
`code_revoked`.

Size: ~2.5 days.

## Phase 2 — interview prep from their real questions (A3)

**Server (deterministic).** `applications.engagement(id)` returns the conversations with the
application's `code_id`: each question in order, the answer, the entries it used (paths), and
`grounded`. A question is grounded when its answer has a cited id, a
`grounded_subjectivity_ids` entry, or a `corpus_search` / `corpus_grep` call with hits in
`tool_calls` — cited ids alone undercount (a private CV is never cited, only grounded, and a
search-only answer cites nothing). Ungrounded questions are the corpus gaps. It needs one new read
on `conversation/facade` (by `code_id`); jobs may import that facade. No model on the server. The
owner's AI could compose the same from `conversations.list(code)` + `conversations.get`, but not the
`grounded` flag, and the admin detail needs the read anyway.

**Owner's AI (reasoning).** An `interview-prep` workflow builds the prep pack: their questions
grouped by theme, a story per question from the corpus, the gaps listed for the owner to fill
(vault first, then `corpus_create` raw → wiki — facts have one home). It is served as an owner
workflow guide (see D17 below), never as a StandMeet skill: skills reach only visitor agents, so an
attached prep skill would hand the owner's private workflow to the recruiter.

It can then set the code's waypoints (`codes_set_waypoints`). A waypoint does not change what the
agent answers; it gives the ghost a destination, so after each answer the recruiter sees one
suggested next question aimed at an unvisited waypoint. Waypoints freeze at session start, so they
reach the recruiter's next session, not the current one. Admin detail shows "their questions" with
gaps marked.

**Tests:** the mock gateway scripts one answer that reads an entry and one that uses nothing; the
engagement read returns both, the second marked as a gap.

Size: ~1.5 days (+ the workflow text).

## Phase 3 — follow-up and funnel (A4 + A5)

**Follow-up (from recorded facts only).** `next_followup_at` set at commit (+7 days). Due when the
time has passed and the application is not opened and its outcome is `none`; after two nudges (each
recorded as a ledger note by the owner's AI) the row is "cold". An opened application is never
nudged blind: the draft cites what they asked.

A periodic job (`periodic.Named` from the jobs plugin's `PeriodicJobs()`; River runs it on the
leader) finds due rows and, per row in one transaction, records `application.followup_due` and moves
`next_followup_at` forward — the gas-refill pattern (`owner/repo/gas_refill.go`), so a rerun never
announces the same due date twice. An existing notify rule puts the reminder in the owner's IM; the
admin list shows "follow-up due"; `applications.followups_due()` serves the owner's AI.

**Funnel.** `applications.funnel()`: per stage the count that ever reached it (from the ledger, so a
rejection after an interview still counts the interview), median days committed → opened and
opened → first outcome, rows still waiting reported as excluded, and medians hidden below n=20.

**Tests:** there is no clock knob, and none is added (`e2e/fixtures/instance.ts:238`; no env knob
for test convenience): a spec backdates the application's `created_at` / `next_followup_at` with
`execSQL`, as other specs backdate rows. Cases: due (announced once across two job runs), cold,
opened-never-nudged; funnel below and above the floor.

Size: ~2 days.

## Built from what exists

| Need | Existing mechanism | Status after reading the code |
|---|---|---|
| When it was opened | conversations under the code; `visit_event.code_id` | conversations hold; page views need the monitor fix above |
| Tell the owner | notify rules → the linked IM chat | holds; needs a `cardFacts` branch for readable cards |
| Withdraw | `RevokeCode` | holds (purges sessions, refuses new ones); runs after the outcome tx, by subscription |
| Work authorization, employers, dates for a recruiter | the `hiring` role reads `subjectivity://cv` | holds for freshly issued codes and a top-level note titled `cv` |
| Hide one path from one recruiter | `codes_set_corpus_denials` | holds; reaches sessions started after the change |
| Suggest the recruiter's next question | code waypoints → ghost | holds as a suggestion, from the next session |
| Fill a corpus gap | `corpus_create` raw → wiki, vault first | holds |
| Follow-up reminders | periodic job + notify rules | holds; needs a stored marker per due date |
| "What is missing for the job loop" | — | `warnings_list` is append-only block data-loss records; this is the D16 doctor, new |
| Owner workflows shipped with the instance | `microsite.guide` pattern (embedded markdown op) | holds; skills do not fit (visitor-only) |
| Untrusted JD text | — | no shared fence exists; D15 adds one |
| Seen across sources, discards, the AI's score | — | `job_fingerprints` stays; a new owner-scoped ledger, see C10 |

New to build: the monitor page-URL code, the outcome axis + ledger, `engaged_at`,
`application.engaged` / `outcome_changed` / `followup_due` with their card facts,
`applications.engagement` (+ one conversation-facade read), the follow-up job. Later (backlog): the
fence helper, the seen ledger with annotations, the workflow guide op, the doctor.

## Verified against the code (2026-10-03)

- **Hiring role and CV.** Fresh application codes get `AssumedRoleID: hiring` (`applications.go:223`);
  the role reads `subjectivity://cv` (`seed.go:55-60`) and the visitor tools search, read and grep
  subjectivity under the one ACL check (`path_acl.go:143`);
  `cv-reachable-only-under-the-hiring-role.spec.ts` proves it. Limits: a reused code keeps its own
  role; the glob matches only the top-level note path `cv`, while `cvWarning`
  (`port/access.go:99-113`) compares slugified titles — a nested `about/cv` passes the warning and
  is unreadable (fix: compare the derived path). Role edits reach new sessions only.
- **Revoke.** `RevokeCode` sets `revoked`, records `code.revoked`, deletes the code's Redis
  sessions (`codes.go:114-128`): the next turn is 401 and a new `POST /sessions` is
  `code_revoked`. The public page still renders at the public tier; past conversations stay.
- **Page views.** `visit_event.code_id` is empty on every recruiter path (beacon has no query or
  auth header; sessions send the code in the JSON body); no spec asserts it. Monitoring off records
  nothing; the beacon fires only after consent.
- **Citations.** "Cited" means opened with `corpus_read` (`agent_turn_persist.go:210-228`);
  `conversations.list` filters by the code string, not `code_id`.
- **Events.** New types must be declared with `Exposure: events.Webhook` (zero value is Internal and
  `event_types_test` fails); then webhooks, notify rules and the rule editor pick them up with no
  wiring. Admin shows type name and description raw (no i18n). The rule form filters only by
  `code_id`.
- **Subscriptions.** Arch rules let `jobsuc` subscribe; the jobs plugin has no `Subscriptions()`
  yet; the type string is declared locally (as `wire/notify.go` does).
- **Periodic jobs.** `periodic.Named`, River, leader-only, MaxAttempts 1, RunOnStart; tickers banned.
- **Warnings.** `warnings.list` reads append-only records whose only writer is the block
  data-loss warning; the admin app never shows it.
- **Skills.** `skill_runner` is `ShapeVisitorOnly`; owner MCP has only skill CRUD; skills are seeded
  at claim and not refreshed on upgrade. The owner MCP server has no prompts capability.
  `microsite.guide` returns an embedded markdown file and is named in `ServerInstructions`.
- **JD text.** `instructionWithPageText` is unexported, one caller, system-prompt only. `jobs.show`
  returns `BodyText` raw; `recruiterBriefing` (`repo_applications.go:237-256`) puts the snapshot's
  title and company into the recruiter's briefing unfenced; `resume_read` returns no snapshot.
- **Fingerprints.** `job_fingerprints` is keyed `(source_id, external_id)`, no `owner_id`, cascades
  with the source, and is written at fetch time — same-source repeats are already blocked.
  Cross-source dedup is in memory only; `jobs.discard` is a Redis `DEL`.
- **Annotations.** `FetchedJob` is copied whole into `resume_drafts.job_snapshot` and then the
  application, so a field on it would travel — but only if a draft is made within the 24 h pool.
- **Mail.** Only `mail.connected` / `mail.send`; nothing reads a mailbox.

## Decisions taken here (change any of them before Phase 1 starts)

- "Opened" = first page view with the code or first conversation, whichever is earlier, and it
  needs the monitor fix — a recruiter who reads the page and leaves has still opened it.
- `withdrawn` moves to the outcome axis; existing `withdrawn` rows migrate.
- The engaged event fires on the first conversation only; a page view does not notify (page views
  are not on the event bus; adding them is not worth it yet).
- Withdraw revokes by subscription, after the outcome commits — not in the same transaction.
- Follow-up messages are drafted by the owner's AI and sent by the owner; the instance never sends
  them.

## After this: suggested order for the rest of the backlog

1. D15 untrusted-content fencing: one exported fence function; wrap `jobs.show` bodies; fence or
   sanitize title and company in `recruiterBriefing` (a second JD path, into the recruiter's
   agent).
2. B6 draft-vs-master structural check, then B7 numeric-claim warnings.
3. C10 + annotations: one owner-scoped seen ledger keyed on the dedup keys (canonical URL,
   company::title::location), written at fetch time, filtered before pooling, not hanging off
   `job_sources` (unregister cascades). `jobs.discard` sets `discarded`; `jobs.annotate` stores
   score + reason on the same row, so the assessment outlives the pool. Score and reason stay out
   of every recruiter-visible read. Then C11 posting-age cutoff.
4. D17 owner workflow guides: an embedded-markdown op like `microsite.guide`, named in
   `ServerInstructions`, versioned with the binary; `interview-prep` from Phase 2 joins
   resume-tailoring and job-description-reading there.
5. C12 liveness before tailoring, C13 probe at register, B8 stored form answers.
6. D16 doctor (also replaces the "use `warnings_list`" idea), D18 pinned marketplace blocks, D19
   upgrade gate, C14 country phrases.
