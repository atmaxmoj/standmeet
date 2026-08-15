# chat-subjectivity — Visitor chat: stance grounding

- **Module:** On a judgment or stance question the model elects to search the `subjectivity` genre and answers from the owner's documented standpoint. That grounding shapes the answer without appearing as a citation, unless the note is flagged to show as a source.
- **Surface:** Visitor chat, on a code whose role grants `subjectivity://`. A public-role code does not grant it, and a deflection there is correct scoping, not under-grounding.
- **Real dep:** A real model, a seeded `subjectivity` note, and a code whose role grants `subjectivity://`.
- **Backing e2e:** `subjectivity-genre` · `subjectivity-not-cited` · `visitor-chat-hidden-source`. Real-LLM lane: `eval-harness/subjectivity-test.sh`. The inducement itself → `gap`.

## Checks

### 1 — The model elects to search subjectivity, uninstructed ⭐
- **Steps:** Enter a session on a code whose role grants `subjectivity://`. Ask a judgment question, such as an opinion or a taste call. Script nothing. Read which genres the model searched, and read the answer.
- **Expected:** The model chooses to search `subjectivity` on its own, and the answer speaks from the owner's documented standpoint in the first person.
- **Mock gap:** The mock's genre routing is keyword-scripted. The inducement — the model reading its header, inferring that this is a stance question, and electing the genre — cannot be exercised against it. A test that scripts the search defeats the check.
- **Backing test:** `subjectivity-genre.spec.ts` (mechanics only) · the inducement → `gap`

### 2 — The control run: the standpoint notes are what changes
- **Steps:** Withhold the genre instead of deleting anything — take `subjectivity://**` off the role, ask the same question again, and read both the answer and the transcript's citation list.
- **Expected:** The citation list changes: the standpoint notes that were named on the granted run are absent on the withheld one. That is the control — it is what proves check 1 measured the notes rather than the prompt.
- **Do not expect the voice to collapse.** It was assumed once and the run disproved it: on a real vault the owner's stance also lives in wiki notes, so the withheld answer is still opinionated and specific. An Expected that stays true either way measures nothing, and deleting a note would break the mirror the corpus is supposed to be.
- **Backing test:** `gap`

### 3 — A grounding note shapes the answer without being cited
- **Steps:** After check 1 grounds on a subjectivity note, read the citation footer.
- **Expected:** The note is absent from the footer. A note carrying `show_as_source` does appear there.
- **Backing test:** `subjectivity-not-cited.spec.ts` · `visitor-chat-hidden-source.spec.ts`

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

The stance answer renders as prose in the owner's voice, not as a hedged summary.
A subjectivity note that shaped the answer does not appear in the footer unless it is flagged to.
A deflection on a code that lacks the grant is correct — read the role before calling it a defect.
