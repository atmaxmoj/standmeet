# chat-subjectivity — Visitor chat: stance grounding

- **Status:** ⬜ not started (new round)
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
- **Result:** ⬜
### 2 — Subjectivity grounds but is not cited  (was §A6)
- **Steps:** after check 1 grounds on a subjectivity note, inspect the citation footer.
- **Expected:** the note shaped the answer but is **absent** from the footer unless it carries `show_as_source`; a `show_as_source` note *does* appear.
- **Backing test:** `subjectivity-not-cited.spec.ts:126` · `visitor-chat-hidden-source.spec.ts:48`
- **Result:** ⬜
## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
The stance answer renders as prose in owner voice; a subjectivity note that shaped the answer must NOT leak into the citation footer unless `show_as_source`.

## Findings
(record here; also log `../findings.md`, ID `F-A-n` historical anchor)

- **F-A-3 re-attributed** (2026-07-14): a public-role code's stance question deflected because `subjectivity://` is out-of-scope for that role — that was *correct scoping*, not an under-grounding bug (see [[chat-redaction]]). Check 1 can only be tested with a code whose role grants `subjectivity://`.
