# resume-match-gauge — the "match / 100" gauge must not claim to read a JD it never reads

- **Status:** 🟡 blocked-by-setup — rot-A2 fix e2e-verified GREEN; manual blocked (0 drafts, pool aged out)
- **Module:** the résumé composer's send-decision affordances. Any number labelled as a measurement
  ("match against X") must actually depend on X, or it must not make the claim.
- **Surface:** `/admin/drafts` → open a draft → the composer top-bar gauge (left of **Send**).
- **Backing e2e:** `resume-match-gauge.spec.ts` (RED→GREEN: the gauge must not keep an identical value
  after the job it targets changes while still claiming to be "match against the job description").

## Checks

### 1 — the "match" number depends on the job description ⭐
- **Steps:** open `/admin/drafts`, open a draft into the composer, note the `match NN / 100` value.
  On the **header** panel, change **company** and **role** to a completely different job (e.g.
  `Blue Bottle Coffee` / `Barista, morning shift`). Touch nothing in summary / skills / experience /
  cover. Re-read the gauge.
- **Expected:** the number changes to reflect the now-different job — a résumé that scored a strong
  "match" for a staff-engineer role should not score the **identical** number for a barista role.
  Equivalently, the honest fix may instead **remove the number** (or drop the false
  "match against the job description" tooltip): what must not survive is a JD-independent number that
  still advertises itself as JD-match.
- **⚠️ the bug this came from:** `confidenceScore` scores a fixed buzzword list over the owner's own
  résumé text and never reads the job — so the value is byte-identical across every job the same
  résumé is applied to, yet sits under "match against the job description" next to Send.
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — 0 drafts (pool aged out); rot-A2 match-gauge fix e2e-verified GREEN. Backing e2e green; not manually driven (no live disproof, no manual proof).
### 2 — nothing else near Send fabricates a job-aware signal
- **Steps:** in the composer top bar and the confirm modal, scan for any other number/badge that reads
  as "how well this fits the job".
- **Expected:** every such signal traces to real job-aware data, or it is not shown. (Today only the
  match gauge exists; fold in any future "fit"/"score" affordance here.)
- **Result:** 🟡 blocked-by-setup this round (outside self-serve scope §0) — 0 drafts (pool aged out); rot-A2 match-gauge fix e2e-verified GREEN. Backing e2e green; not manually driven (no live disproof, no manual proof).
## ⚠️ LOOK — fresh-eyes UI sanity
A "match" score that does not move when you change the job it claims to match is a painted constant,
not a measurement. The tell for the whole fabricated-data class: **it doesn't move when the thing it
claims to measure moves** — here, swap the target job and the number stands still.

## Findings
- **rot-A2** — the `match / 100` gauge is `confidenceScore` over a fixed buzzword list; it never reads
  the job description (the `DraftModel` has no JD field), yet is labelled "match against the job
  description". Likely fix: **remove / relabel** the gauge rather than plumb a real JD-aware score into
  the composer, since the real ML score already lives in the job-loop `resume.draft` path.
