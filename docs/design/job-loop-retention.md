# Job-loop ephemeral retention + ephemeral microsites (v0.1 draft)

Status: built 2026-10-13 (owner: "赶紧给我都做了"). The test plan arrived cut off at TC-22; the
tests are e2e/test/retention-assessment.spec.ts, retention-bundle.spec.ts and
upgrade-retention-bundles.spec.ts, mapped to §2–§7 below.

## 1. Scope

- (a) The assessment on a job-ledger row: what `jobs.annotate` writes (score, reason, deductions,
  cited_notes, flags; also the "actual work" picture and Fermi estimates — today `brief`).
- (b) A microsite with its bound access code and store.
- Out of scope: the ledger row itself (the dedup fingerprint), applications and their timeline,
  the corpus, résumé masters.

## 2. Retention class

- Every assessment and every microsite carries `retention ∈ {forever, ephemeral}`.
- The default is always `forever`. A new item without the field is `forever`. All existing data
  is `forever`: no migration changes it, nothing is applied backwards.
- `ephemeral` is only set explicitly: on one item, or on a whole batch (one picture run).

## 3. Ephemeral assessment lifecycle

- Fields: `retention=ephemeral`, `last_touched_at`, `keep=false`,
  `expires_at = last_touched_at + 90 days`.
- A touch is only: the owner updates the assessment (any annotate field); the owner opens that
  row in history/show; the posting is committed as an application; the owner pins or unpins.
- Not a touch: Job Scout or cron batch reads, automatic scans, list-level paging. Otherwise
  machine reads keep everything alive.
- Pin: `keep=true` exempts the row from the TTL until the owner unpins. The pin shows in history.
- Expiry: 7 days before, history marks the row `expiring`. At expiry the assessment is cleared;
  the ledger row keeps a tombstone: company, title, URL fingerprint, status, `cleared_at`. Dedup
  never breaks: a cleared posting seen again is recognised and marked "assessed before".
- Clearing goes through the existing 90-day trash (restorable). The trash period for the
  ephemeral class is configurable (default 90; 0 = burn at once).
- Promotion: once an ephemeral posting is committed as an application, its assessment becomes
  `forever`.

## 4. Ephemeral microsite

- A microsite can be created with `retention=ephemeral`. The default `forever` is unchanged.
- Visitors see no difference; only the lifecycle differs.
- `last_activity_at` touches: a visitor opens the page with the code, a visitor talks to the
  page's agent, the store is written, the owner edits the page or its store policy.
- Expiry: the page goes offline (its URL serves an "expired" page), the bound code is revoked
  (same meaning as a withdrawal), the store content goes to the trash.
- Pin applies: alone or for the whole bundle.

## 5. Bundles share one clock

- One send-out = assessment + its own code + microsite. Created ephemeral, they share a
  `bundle_id` and one clock.
- A touch on any member renews the whole bundle. A pin on any member exempts the whole bundle. A
  commit makes the whole bundle `forever`.
- At expiry the whole bundle is cleared together: no half-left pieces.
- Use: ephemeral bundles for wide, tentative applications (gone after 90 quiet days); `forever`
  for important targets' long-lived deal rooms.

## 6. Interface (smallest change)

- `jobs.annotate` gains `retention`, `keep`; `jobs.history` / `jobs.show` return `retention`,
  `keep`, `last_touched_at`, `expires_at`.
- Microsite create gains `retention`, `bundle_id`; code revocation gains the reason `expired`.
- A daily sweep handles only unpinned ephemeral items, and writes an audit record per run (what,
  when, why it expired) that the owner can read.

## 7. Invariants

- Defaults and existing data stay `forever`; this spec changes no existing data's fate.
- Clearing removes content, never fingerprints; applications and timelines are never touched.
- `ephemeral` means "fades when nobody touches it". It is not a delete tool; deleting is still
  manual delete + trash.

Decided: (1) clearing uses the existing 90-day trash, not burn-at-once; (2) a commit promotes the
whole bundle to `forever`.

## Decisions (2026-10-13, owner: "赶紧给我都做了")

- **One clock, one home.** Table `retention_bundles(id, owner_id, last_touched_at, keep,
  cleared_at)`. An item is ephemeral iff it has a `bundle_id`; no bundle = forever. A single
  ephemeral assessment gets a one-member bundle. `expires_at`, `expiring` are derived, never stored.
- **Promotion = delete the bundle row.** Members' `bundle_id` is `ON DELETE SET NULL`, so one
  statement makes every member forever (commit, or `retention: forever` on any member).
- **Touches**: `jobs.annotate` (any field), pin/unpin, commit; a visitor opening the page with a
  code, a visitor chat turn on the page, a store write, an owner edit of the page or its store
  policy. **Reads never touch**: Job Scout and the owner share one key today (review note 1), so
  "the owner looked" cannot be told from a machine read. Revisit once Job Scout has its own key.
- **Expiry** (daily periodic "retention sweep", one transaction per bundle; codes are revoked
  first, idempotently, so a crash between steps converges on rerun):
  - assessment: `annotations` move to `job_assessment_trash`, the row keeps the tombstone
    (company, title, URL keys, status) and gets `cleared_at`;
  - microsite: the existing soft delete (trash, 90 days, restorable); the URL serves "expired"
    (410), not a 404;
  - codes bound to the page: revoked with `revoked_reason = 'expired'`;
  - an audit event `retention.bundle_cleared` lists the members.
- **Trash period** for cleared assessments: 90 days, a constant for now (ponytail: an instance
  setting if the owner wants burn-at-once).
- **Restore** (`retention.restore`, by bundle): assessments come back, the page comes back, the
  clock restarts. Revoked codes stay revoked; the owner issues a new one.
- A cleared row seen again is still deduped and carries the flag `assessed_before`.

## Review notes (Claude, 2026-10-13) — to settle before the tests

1. **Who touched it.** "The owner opened it" and "Job Scout read it" both arrive through the
   owner's MCP key today. Telling them apart needs Job Scout on its own key (roadmap 8.5.b), or
   counting only the admin UI's row view and `jobs.annotate` as touches.
2. **`jobs.show` reads the pool** (by `cache_id`), not the ledger row. The touch for "opened the
   row" belongs on the ledger read the panel makes.
3. **Test plan vs repo rules.** The repo tests end to end first, and adds no env knob for test
   convenience. Time is advanced the way the corpus-trash specs do it: backdate the rows, then run
   the periodic job. Not an injected fake clock. Units only for the TTL arithmetic.
4. **TC-21 (crash mid-sweep)**: one transaction per bundle gives "all or nothing" by
   construction; the test kills the backend between bundles.
5. **`brief` and the recruiter-visible `homework`** (queued) are assessment content, so they
   fall under §3 and promote with the bundle.
6. Test plan text stops at TC-22; TC-22 onward is needed.
