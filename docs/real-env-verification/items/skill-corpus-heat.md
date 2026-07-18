# skill-corpus-heat — the skill "heat" must be measured, or absent (deferred)

- **Status:** ⏸ deferred (2026-07-17). The design shows a "corpus-inferred skill heat graph" on
  /admin/skills to drive job-loop matching. It was once **fabricated** (`deriveHeat = 95 - index/...`,
  the heat was the row's list index) and has been **removed** — there is no corpus-stats endpoint to
  feed it honestly. This item tracks wiring a REAL heat signal (skill ↔ corpus tag/recency) before any
  such graph returns.
- **Module:** skill relevance ranking for the job loop.
- **Surface:** `/admin/skills`.

## Check (when built)
- **Steps:** with a corpus that mentions skill A heavily and skill B not at all, open the skill heat.
- **Expected:** A ranks hotter than B, and the values trace to a real corpus query — not to list order.
- **Result:** ⬜ deferred — needs a corpus-stats endpoint. Until then, no graph (empty), never a fake one.
