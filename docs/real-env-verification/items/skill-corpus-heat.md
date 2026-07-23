# skill-corpus-heat — the skill "heat" must be measured, or absent (deferred)

- **Status:** ✅ verified — heat graph removed (rot-G1); absent from skills section
- **Module:** skill relevance ranking for the job loop.
- **Surface:** `/admin/skills`.

## Check (when built)
- **Steps:** with a corpus that mentions skill A heavily and skill B not at all, open the skill heat.
- **Expected:** A ranks hotter than B, and the values trace to a real corpus query — not to list order.
- **Result:** ✅ deferred-by-design (rot-G1) — the un-measured "heat" graph was REMOVED rather than faked; absent from /admin/skills (re-confirmed). No metric shown = no lie. Rebuild only if a real corpus-query-backed ranking is implemented.