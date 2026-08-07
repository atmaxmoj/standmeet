# skill-corpus-heat — the skill "heat" must be measured, or absent

- **Module:** Skill relevance ranking for the job loop. The product may show a "heat" figure per skill only when a real corpus query produces it.
- **Surface:** `/admin/skills`.
- **Real dep:** A corpus that mentions one skill heavily and another not at all.
- **Backing e2e:** `gap`.

## Checks

### 1 — No heat figure appears unless a corpus query produced it ⭐
- **Steps:** Open `/admin/skills`. Look for any per-skill heat, score or ranking figure.
- **Expected:** Either no such figure exists anywhere on the surface, or every figure traces to a real corpus query. A figure derived from list order, from a fixed word list, or from any constant fails this check. Showing nothing is a correct outcome here; showing an unmeasured number is not.
- **Backing test:** `gap`

### 2 — A measured heat ranks by the corpus, not by order
- **Steps:** Use a corpus that mentions skill A heavily and skill B not at all. Open the heat figure, if one exists. Compare A against B. Reorder the skill list and read both again.
- **Expected:** A ranks hotter than B. The values do not change when the list order changes.
- **Backing test:** `gap`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Every number on this surface answers "measured from what?".
A metric with no source is worse than a blank space, because the owner will act on it.
Absence is a legitimate design outcome here — read a missing graph as a decision, not as a gap.
