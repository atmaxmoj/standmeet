# resume-match-gauge — the "match / 100" gauge must not claim to read a JD it never reads

- **Module:** The résumé composer's send-decision affordances. A number labelled as a measurement of X must depend on X, or it must not make the claim.
- **Surface:** `/admin/drafts` → open a draft → the composer top bar, left of **Send**.
- **Real dep:** At least one live draft. Drafts come from the job pool, which ages out after a day, so fetch jobs first.
- **Backing e2e:** `resume-match-gauge.spec.ts`.

## Checks

### 1 — The "match" number depends on the job description ⭐
- **Steps:** Open `/admin/drafts`. Open a draft into the composer. Read the `match NN / 100` value. On the header panel, change **company** and **role** to a completely different job, such as `Blue Bottle Coffee` / `Barista, morning shift`. Change nothing in summary, skills, experience or cover. Read the gauge again.
- **Expected:** The number changes with the job. A résumé that scores a strong match for a staff-engineer role does not score the identical number for a barista role. Removing the number, or dropping the "match against the job description" label, also satisfies this check. What must not survive is a JD-independent number that advertises itself as a JD match.
- **Backing test:** `resume-match-gauge.spec.ts`

### 2 — Nothing else near Send fabricates a job-aware signal
- **Steps:** Scan the composer top bar. Scan the confirm modal. Find every number or badge that reads as "how well this fits the job".
- **Expected:** Every such signal traces to real job-aware data, or it is not shown.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

A score that does not move when you change the thing it claims to measure is a painted constant.
That is the tell for the whole fabricated-data class: move the input, and watch whether the output moves.
Here, swap the target job and read the number again.
