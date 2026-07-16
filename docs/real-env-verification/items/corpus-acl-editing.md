# corpus-acl-editing — Corpus ACL: owner edits what each role / code may read + cite

- **Status:** 🟡 ⑤ ran (2026-07-16). Checks 1 + 2 **PASS on the real prod GUI** (role grant editor
  and per-code take-back both save, survive reload, and inherit correctly) — F-A-11 closed.
  Two real bugs found and fixed during the pass, both re-verified on the GUI: **F-A-13** (a failed
  load rendered as `(role grants nothing)` — the page showed no error at all) and the code card
  printing a raw role UUID. Still open: **F-A-14** (the editor is a naked URI textarea — the owner
  hand-types `subjectivity://cv`), whose picker needs **F-A-15** (subjectivity had no tree; the
  backend half is now built). Checks 3-5 not yet driven.
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
- **Result:** ✅ **PASS** (2026-07-16, real GUI). `subj-verify` granted `subjectivity://** + wiki://**`
  → edited to `subjectivity://standpoint + wiki://**` → save → **reload** → the box shows the new list
  and `GET /roles/` returns it. F-A-11's editor is real end-to-end. (The frozen-at-issue half of this
  check is not yet driven — it needs a code issued after the edit.)
  ⚠️ But see **F-A-14**: it passed *as a mechanism* while being the wrong affordance.

### 2 — Owner narrows ONE code below its role
- **Steps:** `/admin/codes` → a code card → `corpus · taken back on this code` → add `subjectivity://cv` → save. Enter as a visitor on THAT code and ask about the CV; then on a different code of the same role.
- **Expected:** the narrowed code cannot read it (agent says it has nothing); the other code still can. The card shows both lists (inherited grant / taken back) so the owner sees the effect without cross-referencing.
- **Backing test:** `code-corpus-narrowing.spec.ts` (4 cases; RED→GREEN proven by making the plugin drop the denials).
- **Result:** ✅ **PASS** (2026-07-16, real GUI, after applying the missing tables to the prod DB).
  `GHOST-SIL1` took back `subjectivity://cv` → saved → reload → still there; `GHOST-WP1` (same role)
  unaffected. The card shows the inherited grant as its real current value — `subjectivity://standpoint
  wiki://**`, i.e. exactly the edit check 1 made on the role, so role→code inheritance is live.
  The visitor-read half is covered by `code-corpus-narrowing` (RED→GREEN via the plugin).
  This check is what surfaced **F-A-13**: the blocking 500 was rendered as `(role grants nothing)`.

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

**Ask the affordance question, not just the mechanism question** — this pass's lesson, and the reason
F-A-14/15 exist. Every check above can pass while the control is still wrong to put in front of a
person. So, for any control:
- Does it make the owner **recall** an exact string (a URI, a slug) instead of **pick** from what
  exists? Recall-not-recognition + no validation = a control that fails silently.
- Is there a **real structure** behind it (a tree, a list) that the admin already loads elsewhere and
  this control is ignoring?
- **What does an empty state assert?** If it reads as a fact ("role grants nothing", "0 sent"), a
  failed load wearing it is a lie — and if the lie points at "nothing to do here", nobody will catch
  it. That is F-A-13, and it was invisible on a page whose every mechanism check passed.

## Findings
(record here; also log `../findings.md`)

- **F-A-13** ✅ **CLOSED** (fixed 9f458bad; re-verified on the real prod GUI 2026-07-16: 0 console
  errors, the card shows the real inherited grant).  Original finding:
  **a failed load renders as an authoritative empty.** On prod, `GET /codes/{id}/corpus`
  500s on every code (`relation "code_corpus_denials" does not exist` — the prod DB volume predates
  the table). The GUI shows **no error at all**: six cards read `(role grants nothing)`.
  Fault: `CodeCorpusConfig.tsx:43` `.catch(() => setLoaded(true))` — the error is swallowed and the
  card renders as if the fetch returned an empty grant. The lie points at "you're already locked
  down", so the owner would never chase it. Same class, same file-pattern, 2 more sites:
  `DashboardSection.tsx:157` (`.catch(() => setSent(0))` → a confident "0 sent") and `:203`
  (`.catch(() => setRows([]))`). The rule is already written in `use-latest-list.ts` ("加载失败别静默
  成空列表：空 vs「没拉到」owner 得分得清") and has a correct implementation there to copy.
  Guard: `admin-load-failure-not-empty.spec.ts` (3 cases, route-forced 500).
- **F-A-14** 🔴 — **the corpus ACL editor makes the owner hand-type URIs.** Both the role grant box and
  the per-code take-back box are naked textareas: the owner must know the scheme and the exact
  server-side slug of a note (`subjectivity://cv`), with no discovery, no completion, no validation.
  A typo is silent — on the take-back side it silently costs reads; on the **grant** side it silently
  grants nothing. The corpus is a real tree and the admin already lazy-loads it
  (`CorpusLazyTree` + `GET /corpus/{genre}/tree`, whose rows already carry a server-slugged `path`) —
  the picker should be generated from that tree, emitting exactly `domain.FormatURI(genre, path)`.
  A raw-glob escape hatch must remain, and must **preserve** globs the tree can't represent
  (`wiki://**/draft`) rather than round-tripping them away.
  **Status:** open. The tree it needs for subjectivity now exists server-side (F-A-15).
  Note the glob dialect makes "this note **and** its subtree" two globs (`g://p` + `g://p/**`) —
  `g://p/**` does not match `g://p` — so one checkbox per row must emit both when the row has
  children. Decide that in the component, not in the matcher.
- **F-A-15** 🟡 — **subjectivity has no owner-facing browse surface at all.** Backend built
  (`NoteRepo.ListChildrenTree` + `GET /corpus/subjectivity/tree`, 5fe116d3); the admin UI that
  browses it, and F-A-14's picker on top, are still owed.  Original finding: The tree route dispatches
  `raw|wiki|output` only (`corpus.go:38`); `writing` has its own `/writings/tree`; **subjectivity has
  neither**, and `postgres.NoteRepo` has `ListChildren` but no `ListChildrenTree`. So the genre that
  holds the CV — the one this whole ACL exists to protect — cannot be listed, browsed, or picked from
  in the admin. Blocks F-A-14's picker for the exact case that motivated it.

- **F-A-11** — corpus URIs had no owner editor (grants write-once). Fixed: `RoleCorpusConfig`.
- **Silent citation zeroing** — the entry form omitted `show_as_source`; Go decoded it `false`.
  Fixed: the form carries it; guard `wiki-citation-toggle`.
- **Plugin dropped the denials** — caught by e2e only: the denial stored, the ACL function correct,
  and the sandboxed retrieval plugin forwarded `corpus_uris` but not `corpus_denials`, so the host
  served what the owner took back. The unit test could not see it; the compiler could not either.
