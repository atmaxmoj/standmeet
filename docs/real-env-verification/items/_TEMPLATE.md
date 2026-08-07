# <slug> — <what this module is, in five words>

<!-- ─────────────────────────────────────────────────────────────────────────
COPY THIS FILE TO START A NEW ITEM. Rename it to the module slug. Fill every field.

RULE 1 — an item is a TEST DESCRIPTION. Never write status in an item.
  Do not write ✅ / 🔴 / 👁 / "verified" / "fixed" / "Result" / "Status".
  Do not write the date of a run.
  A run's status lives in that round's `runsheet.md`.
  A defect's status lives in `../findings.md`.
  An item that also carries status becomes a second ledger. Two ledgers drift.
  The item must read the same before a round and after it.

RULE 2 — one check states one observable outcome. Split any check that says "and".

RULE 3 — write Expected so a mismatch is unambiguous.
  "It works" is not an Expected. "The card reads EDIT" is.

RULE 4 — name the backing test, or write `gap`. Never leave it empty.

RULE 5 — use only the fields below.
  A new field name means the content belongs somewhere else. Usually `../findings.md`.

RULE 6 — describe the check, not its history.
  Write "the excerpt contains no `[[`". Do not write "this used to leak wikilinks".
  History belongs in `../findings.md`, keyed by finding id.

`make verify-items` enforces rules 1 to 5, and runs inside `make lint`.
It bans four shapes: a field name outside the whitelist, a verdict glyph, a run's date,
and round vocabulary. It also fails a check that lacks Steps, Expected or Backing test.
Files whose name starts with `_` are exempt, so this template may quote what it bans.
───────────────────────────────────────────────────────────────────────── -->

- **Module:** What the module does. One or two sentences. Say the capability, not the code.
- **Surface:** Where a human drives it. Name the route and the control.
- **Real dep:** The real external thing this needs. Write `none` if it needs none.
- **Backing e2e:** The spec files that cover this module. Write `gap` for what nothing covers.

## Checks

### 1 — <the outcome, written as a claim> ⭐
- **Steps:** The exact actions a human takes. One action per sentence.
- **Expected:** What the human must observe. Write it so a mismatch is unambiguous.
- **Mock gap:** What the harness cannot reproduce here. Omit this field if nothing is missing.
- **Backing test:** The spec that asserts this, or `gap`.

### 2 — <the next outcome>
- **Steps:**
- **Expected:**
- **Backing test:**

<!-- ⭐ marks the check that matters most on this module. Use it at most twice. -->

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The task-free sweep for this surface. Name what a first-time eye must find true here.
Ask three questions and write the answers as claims:
what a label asserts, what two views must agree on, and what every affordance must do.
