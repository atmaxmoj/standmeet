# chat-subjectivity — Visitor chat: stance grounding

- **Status:** ✅ BOTH checks green (2026-07-15 live) — the ⭐ inducement works on real DeepSeek, and check 2 is now proven numerically on the truly-synced corpus (19 wiki cited + 11 subjectivity grounded-but-withheld = the 30 reads). F-A-3 confirmed as correct-scoping, not a grounding bug.
- **Module:** on a judgment/stance question the model elects to search the `subjectivity` genre and answers *from the owner's documented standpoint* — grounding it shapes the answer but is not cited unless flagged.
- **Surface:** visitor chat (a code whose role grants `subjectivity://`).
- **Real dep:** real DeepSeek + a seeded `subjectivity` note; a code whose role grants `subjectivity://` (public role does NOT — see [[chat-redaction]]).
- **Inherits (historical finding IDs):** `F-A-3` (stance question cited wiki-only, deflected — later re-attributed as correct scoping for a public-role code; see chat-redaction).
- **Backing e2e:** `subjectivity-genre` · `subjectivity-not-cited` · `visitor-chat-hidden-source`. Real-LLM lane: `eval-harness/subjectivity-test.sh`.

## Checks

### 1 — Subjectivity grounding by INDUCEMENT ⭐  (was §A5)
- **Steps:** ask a judgment/stance question (opinion, taste, "what do you think of X"). The visitor prompt is nudged only by `visitor-header.md` — nothing scripts a search. Observe whether the real model **chooses** to search the `subjectivity` genre and answers *from that standpoint*. Control run: strip the subjectivity note → the answer should go generic.
- **Expected (likely RED):** with the subjectivity note present, a stance-grounded first-person answer that reflects the owner's documented opinion; without it, a generic answer. This is **the one route with no deterministic backing** — the mock can only reproduce it if a test scripts the search, which defeats the point.
- **⚠️ mock gap:** the mock's genre routing is keyword-scripted; the *inducement* (model reads `visitor-header.md`, infers "this is a stance question", elects to search `subjectivity`) is never exercised.
- **Backing test:** `subjectivity-genre.spec.ts:47` (mechanics of read/search) · `subjectivity-not-cited.spec.ts:126`. The inducement itself → no deterministic backing (gap).
- **Result:** ✅ (2026-07-15 live). Set up a `subj-verify` role (`subjectivity://** + wiki://**`) + code `SUBJ-V01`, entered as a coded visitor, asked *"a contrarian take most peers would disagree with?"* → real DeepSeek **SEARCHED 4 · READ 20 · REFERENCES · 3** and took a **documented owner stance**: *"Above any collaboration, there must be a seat that can arbitrate… a deadlocked dyad has no interior exit… No concept introduced without consent — the fluent collaborator is the first smuggler to watch… play is not exempt from rigor."* These are the owner's real subjectivity notes (coordinator-not-arbiter, no-concept-without-consent) — the model **elected** to search subjectivity and grounded a first-person stance, not a generic deflection. The ⭐ "no deterministic backing" route confirmed working on the real model. (Fixture: role `subj-verify` + code `SUBJ-V01` left in the instance for re-runs, incl. [[chat-ghost]] once waypoints are added.)

### 2 — Subjectivity grounds but is not cited  (was §A6)
- **Steps:** after check 1 grounds on a subjectivity note, inspect the citation footer.
- **Expected:** the note shaped the answer but is **absent** from the footer unless it carries `show_as_source`; a `show_as_source` note *does* appear.
- **Backing test:** `subjectivity-not-cited.spec.ts:126` · `visitor-chat-hidden-source.spec.ts:48`
- **Result:** ✅ **GREEN (2026-07-15 live, real DeepSeek, the truly-synced corpus).** Asked *"a take you hold that most people in your field would disagree with?"* under `SUBJ-V01` → a real first-person stance answer grounded in the owner's documented positions (*"the problem isn't the question — it's the form… answers are functions, not constants"* — his `stiff-questions-soft-capture` / `lossy-self-presentation` thinking). **The arithmetic closes exactly, which is what makes this proof rather than absence-of-evidence:** the persisted turn carries `cited_wiki_ids: 19` **and `cited_subjectivity_ids: 11`**, and 19 + 11 = **30 = the visible `READ 30` counter**. The footer renders **`REFERENCES · 19`, every entry `wiki·`, zero subjectivity** (`anySubjectivity: false`). So the 11 subjectivity notes were read, grounded the answer, and were withheld from the footer — the gate works. This is NOT the trivial pass ("it never read subjectivity, so of course it cited none"): the separate `cited_subjectivity_ids` channel proves they were read and routed, exactly as [[chat-redaction]]'s server-authoritative design intends. Reachability independently confirmed: an LLM-free `QUERY corpus_search` under the same code returns `subjectivity:` hits (`recording-discipline`, `not-just-selling-hours`, `there-must-be-an-arbiter-above`).

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The stance answer renders as prose in owner voice; a subjectivity note that shaped the answer must NOT leak into the citation footer unless `show_as_source`.

## Findings
(record here; also log `../findings.md`, ID `F-A-n` historical anchor)

- **F-A-3 re-attributed** (2026-07-14): a public-role code's stance question deflected because `subjectivity://` is out-of-scope for that role — that was *correct scoping*, not an under-grounding bug (see [[chat-redaction]]). Check 1 can only be tested with a code whose role grants `subjectivity://`.
