# corpus-acl-editing — Corpus ACL: owner edits what each role / code may read + cite

- **Status:** 🟡 built (2026-07-16), manual ⑤ owed — role editor + per-code narrowing + citation control all shipped; the real-GUI pass is the remaining step.
- **Module:** the owner controls, from the admin GUI, **which corpus URIs each role may read**, **which of those each code takes back**, and **whether a note may be cited once read**. subjectivity is not special — wiki / output / writing / subjectivity are one glob mechanism.
- **Surface:** `/admin/roles` (grant) · `/admin/codes` (per-code narrowing) · wiki/output entry form (citation).
- **Real dep:** real prod stack; a code whose role grants a genre containing a note that code shouldn't see.
- **Inherits:** `F-A-11` (corpus URIs had no owner editor — grants were write-once in the create modal).
- **Backing e2e:** `code-corpus-narrowing` (4, incl. RED→GREEN) · `wiki-citation-toggle` (1 green + 2 skipped, see below) · domain: `corpus_scope_test` (6, RED→GREEN).

## The model (say it once, it governs every check below)

Two knobs, orthogonal. The UI must not let the owner confuse them:

| knob | lives on | governs | where |
|---|---|---|---|
| corpus URI glob | role (grant) + code (take-back) | can the agent **READ** it | /admin/roles · /admin/codes |
| `show_as_source` | the note | once read, may it be **CITED** | entry form |

Turning citation off ≠ hiding: the agent still reads it and still uses it to answer — it just isn't
attributed. To make it unreadable, take back its URI.

## Checks

### 1 — Owner narrows an existing role's grant
- **Steps:** `/admin/roles` → a role card → `corpus` box → change `subjectivity://**` to a per-note list (`subjectivity://standpoint`) → save. Re-issue a code on that role, chat, ask about the excluded note.
- **Expected:** the save sticks (reload shows the new list); a session issued AFTER the edit cannot read the excluded note; sessions issued BEFORE are unaffected (role is frozen at issue — that is the design, not a bug).
- **⚠️ mock gap:** role specs seed `corpus_uris` via the API, so the GUI path — the only one a real owner has — was never driven (that IS F-A-11).
- **Result:** ⬜

### 2 — Owner narrows ONE code below its role
- **Steps:** `/admin/codes` → a code card → `corpus · taken back on this code` → add `subjectivity://cv` → save. Enter as a visitor on THAT code and ask about the CV; then on a different code of the same role.
- **Expected:** the narrowed code cannot read it (agent says it has nothing); the other code still can. The card shows both lists (inherited grant / taken back) so the owner sees the effect without cross-referencing.
- **Backing test:** `code-corpus-narrowing.spec.ts` (4 cases; RED→GREEN proven by making the plugin drop the denials).
- **Result:** ⬜

### 3 — A denial cannot OPEN anything (the ACL's iron rule)
- **Steps:** on a code, take back a glob the role never granted (e.g. `output://**` on a wiki-only role).
- **Expected:** nothing changes — code may only subtract (A.4 pure-AND). A typo in the take-back list can only ever cost reads, never leak.
- **Result:** ⬜

### 4 — Citation control + its explanation ⭐
- **Steps:** wiki entry form → the `citable` checkbox. Read the help text. Uncheck → save → chat so the agent reads that note.
- **Expected:** the agent still grounds on it (it is READ), but the answer's REFERENCES footer omits it. The form explains this distinction in place — an unlabelled checkbox would be guessed wrong.
- **⚠️ the bug this came from:** the form used to omit `show_as_source` entirely, so Go decoded it as `false` and **editing a note's body silently turned its citation off**. Guard: `wiki-citation-toggle`.
- **Result:** ⬜

### 5 — Editing a note doesn't move controls the owner didn't touch
- **Steps:** open a citable note, change ONLY the body, save. Check `show_as_source` afterwards.
- **Expected:** unchanged. (This is check 4's bug, stated as an invariant: an edit form must not zero a field it didn't show.)
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The role card's corpus box shows the REAL current list (not a placeholder); the code card shows
inherited vs taken-back distinctly (not one merged list the owner has to decode); the citation
checkbox is never presented without its explanation.

## Findings
(record here; also log `../findings.md`)

- **F-A-11** — corpus URIs had no owner editor (grants write-once). Fixed: `RoleCorpusConfig`.
- **Silent citation zeroing** — the entry form omitted `show_as_source`; Go decoded it `false`.
  Fixed: the form carries it; guard `wiki-citation-toggle`.
- **Plugin dropped the denials** — caught by e2e only: the denial stored, the ACL function correct,
  and the sandboxed retrieval plugin forwarded `corpus_uris` but not `corpus_denials`, so the host
  served what the owner took back. The unit test could not see it; the compiler could not either.
