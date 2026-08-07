# corpus-acl-editing — Corpus ACL: owner edits what each role / code may read + cite

- **Module:** The owner controls, from the admin GUI, which corpus URIs each role may read, which of those each individual code takes back, and whether a note may be cited once it has been read. Subjectivity is not special — every genre is one glob mechanism.
- **Surface:** `/admin/roles` to grant, `/admin/codes` to narrow one code, and the entry form for the citation control.
- **Real dep:** A real corpus, and a code whose role grants a genre containing a note that code should not see.
- **Backing e2e:** `role-corpus-picker` · `code-corpus-narrowing` · `wiki-citation-toggle` · `admin-load-failure-not-empty` · `admin-codes-with-role` · Go `corpus_scope_test`.

## The model

Two knobs, orthogonal. The UI must not let the owner confuse them.

| knob | lives on | governs | edited at |
|---|---|---|---|
| corpus URI glob | role grant, plus a per-code take-back | whether the agent may **read** it | `/admin/roles` · `/admin/codes` |
| citation flag | the note | once read, whether it may be **cited** | the entry form |

Turning citation off is not hiding. The agent still reads the note and still answers from it; it
simply is not attributed. To make it unreadable, take its URI back.

## Checks

### 1 — Narrowing a role's grant takes effect on new sessions ⭐
- **Steps:** Open a role. Change a whole-genre grant to a per-note list. Save and reload to confirm it stuck. Issue a new code on that role and ask about an excluded note. Then use a session that was issued before the edit.
- **Expected:** The save persists. A session issued after the edit cannot read the excluded note. A session issued before is unaffected, because a role is frozen at issue — that is the design.
- **Mock gap:** The role specs seed grants through the API, so the GUI path — the only one a real owner has — is not driven there.
- **Backing test:** `role-corpus-picker.spec.ts`

### 2 — One code can be narrowed below its role
- **Steps:** Open a code. Add a take-back for a URI its role grants. Save. Enter as a visitor on that code and ask about it. Then enter on a different code of the same role and ask again.
- **Expected:** The narrowed code cannot read it. The sibling code still can. The card shows the inherited grant and the take-back as two distinct lists, so the effect is visible without cross-referencing another page.
- **Backing test:** `code-corpus-narrowing.spec.ts`

### 3 — A take-back can only subtract ⭐
- **Steps:** On a code, take back a glob its role never granted.
- **Expected:** Nothing changes. A take-back can only ever cost reads. A typo in that list can never open anything.
- **Backing test:** `code-corpus-narrowing.spec.ts` · `corpus_scope_test`

### 4 — The citation control is present and explained ⭐
- **Steps:** Open a wiki entry form. Find the citation control and read the help text beside it. Turn it off and save. Chat so the agent reads that note.
- **Expected:** The agent still grounds on the note, and the answer's references omit it. The form explains that distinction in place — an unlabelled checkbox here is guessed wrong in both directions.
- **Backing test:** `wiki-citation-toggle.spec.ts`

### 5 — Editing a note does not move a control the owner did not touch
- **Steps:** Open a citable note. Change only the body. Save. Read the citation flag afterwards. Repeat on each genre.
- **Expected:** Unchanged. An edit form must not zero a field it did not show.
- **Backing test:** `wiki-citation-toggle.spec.ts`

### 6 — A failed load never wears an empty state
- **Steps:** Make the role list or the corpus scope fail to load. Read what the page says.
- **Expected:** It says it could not load. It does not render the empty state, because "this role grants nothing" is a claim about the world, and a failed load wearing it is a lie that points at "nothing to do here".
- **Backing test:** `admin-load-failure-not-empty.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The role card shows the real current list, not a placeholder.
The code card keeps inherited and taken-back visibly separate, rather than one merged list the owner must decode.
The citation control never appears without its explanation.

Ask the affordance question, not only the mechanism question — every check above can pass while the
control is still wrong to put in front of a person:
does it make the owner recall an exact string instead of picking from what exists;
is there a real structure behind it that the admin already loads elsewhere and this control ignores;
and what does its empty state assert when it is wrong?
