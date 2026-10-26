# Cue defect ledger (cue-defect-loop §2 / §8)

The persisted record of every closed cue-card defect. The spec (`cue-defect-loop`) asks for two things
this file holds: a durable ledger (§8) and the golden-set that L3 regression re-runs (§5.2).

- **Executable golden set (§5.2):** `backend/internal/owner/jobs/cues/cue_eval_internal_test.go`,
  `evalCases()` — one case per closed defect, each carrying the defect's original question verbatim
  and its §6 fit check, PLUS the cue-generic-fabrication-fix §4 acceptance set: three generic probes
  (`generic/*`, V3 — no personal node may be cited, no From line) and one grounded personal control
  (`personal/larkspur-grounded`, V4 — the mechanical From must equal the real sources). The eval
  checks each card as the owner SEES it, after `cue.go`'s `stampFrom` writes the From line. Run it
  (`CUE_EVAL=1 CUE_EVAL_PROVIDER=… -run TestCueEval`, PII-free synthetic persona, any
  anthropic-compatible provider) as the L3 golden-set regression; it must stay all-green. **Add a
  case here and a row below when a defect closes.**
- **This file (§8):** one row per defect, in the §2 schema, so a drift that keeps hitting one material
  cluster surfaces as a pattern.

Row schema (spec §2): `{question, card gist, grounding nodes, scene (stage/role), verdict source,
one-line reason, class, status, fix, golden-set case}`.

---

## D1 — frame drift: a deployment question answered as testing methodology

- **question:** "How would you take a researcher's rough model prototype and turn it into a reliable
  production API serving real traffic at scale?" (the §0 incident, mock interview S2, technical round)
- **card gist:** whole card built on "stages & gates" — machine-checkable stage gates, golden-set
  regression, fresh-eyes audit.
- **grounding nodes:** `stages-and-gates`, `testing-software-3-0`, `golden-set` (owner's AI-pipeline
  testing-methodology cluster).
- **scene:** stage S2, technical round; reproduced with a strongly-anchored rephrase too — same wrong
  cluster, so the drift is retrieval gravity, not wording.
- **verdict source:** owner, live ("非常不行").
- **one-line reason:** the methodology cluster is lexically dense in stages/gates/reliable/shipped;
  BUT the 2026-10-25 debug re-run proved the frame was NOT in retrieval — the fed context contained
  no "stages-and-gates"/"testing-software" at all, and the fabricated `From:` named nodes that were
  never fed. The frame came from the PROMPT'S OWN few-shot example card, and the `From:` line was
  model-written rhetoric. **Class: F1 (wrong-node drift) + F4 (frame mismatch) + fabrication.**
- **status:** CLOSED (definitively, 2026-10-25). The 2026-10-22 fix targeted the wrong layer
  (retrieval/domain gate + a "never the FRAME" rule); a rule cannot beat a few-shot example, so the
  card still drifted. See cue-generic-fabrication-fix spec §0.
- **fix (surface, not the question — spec §4):** three surface fixes, none per-question:
  - **F-1 — de-prime the frame:** the sample card in `cuesContent` is now a pure LAYOUT skeleton with
    no methodology nouns; the Key example (`budget + timeline`), the bare-label example
    (`good architecture`), the "never its FRAME" rule and the `cuesDiscipline` text no longer name
    stages/gates/testing-methodology anywhere. `TestSamplePromptHasNoFrameLeak` fails if any returns.
  - **F-2 — the From line is the server's, not the model's:** the prompt forbids a `From:` line and
    asks for a `USED: <paths>` declaration; `cue.go`'s `stampFrom` strips any model `From:`, intersects
    the declared paths with the real `sources`, and stamps one `_From:_` from that intersection. A
    forged node (not in sources) is impossible. `TestStampFrom*` guards it.
  - **F-3 — generic-question mode (always on, supersedes the H3 switch):** a generic process/method
    question with no on-point note is answered from general judgment, marked `_General — not from your
    notes._`, with `USED: none` → no `From:` (F-3d). No corpus bridge, no personal attribution.
- **V1 stabilisation (2026-10-25 acceptance follow-up).** The accident question is genuinely
  ambiguous (generic how-to vs "tell me your experience"), so the model's generic/grounded LABEL can
  still wobble run-to-run — but the specific HARM (an adjacent project note presented as the owner's
  grounded experience, with a From and no marker) is now closed by two **deterministic** backstops in
  `stampFrom` (`groundedCitations`), independent of model variance:
  - a card the model marked generic carries NO From — generic judgment never cites the owner;
  - a project note (`software/project/<slug>`) grounds a card ONLY when the question NAMES that
    project (the same G2 signal, threaded as `Prompt.NamedProjects`). An unnamed project's note is
    adjacent and dropped from the From whatever the model declared in USED.
  **The threshold (owner-approved):** on-point = a note whose SUBJECT is the question's subject (a
  general-principle note that directly answers counts); a specific project's note is on-point only
  when named. Verified reproducible live 2026-10-25: the frame question (names no project) — the model
  declares `USED: model-to-production, larkspur` every run, and every run the server stamps only
  `_From: software/engineering/model-to-production_`, dropping the unnamed Larkspur (4/4 identical,
  on top of 3 clean full-set runs). `TestFinalizeProjectNeedsNaming` / `TestFinalizeGenericMarkerStripsCitation` guard it.
- **Two-state invariant + observability (follow-up #2, v0.1.173).** Re-verification found a THIRD
  state: cards with NEITHER a general marker NOR a From (the model omitted its USED line) — a
  verifier can't tell general judgment from an uncited note-rewrite. `cue.go`'s `finalize` now makes
  every card one of two states: grounded (a non-empty stamped From, no marker) XOR generic (the
  `_General — not from your notes._` marker, no From). The gray third state resolves to generic — a
  card that declared no usable source is never shown as the owner's uncited grounded experience, so
  a model omitting USED can only UNDER-claim, never fabricate grounding. A process answer from the
  job posting (H2) is its own grounded case: it declares `USED: posting` and the server cites
  `the role's posting` (not a misleading "not from your notes" marker). `assistant.cue` now returns
  a `citation` object — `{mode, sources, used, from}` — so a verifier checks the state mechanically,
  not by parsing the card (proposal C). Guards: `TestFinalizeNoThirdState`, `TestFinalizePostingIsGrounded`,
  and `twoStateFail` runs on every live eval card. 8 clean full-set runs (claude-haiku-5-5). Residual:
  the model's generic/grounded LABEL can still wobble on a truly ambiguous question — inherent; what
  is guaranteed is the two-state shape and no fabricated grounding.
- **Marker-vs-body mismatch (v0.1.174, the 错配 spec).** Follow-up #2's two-state guarded the MARKER
  but not the BODY: a personal question ("a time something broke on your own systems") came back
  generic-marked with a first-person incident body, because the model declared `USED: deployment,
  design-principles` (short names) and `usedPaths` did EXACT path matching → no match → false
  downgrade → a lying marker on a personal body. Fixes (`cite.go`, split out of cue.go):
  - **R1 usedPaths suffix match:** a short USED name resolves to the full source path by a unique
    segment-aligned suffix (exact wins; an ambiguous tail shared by >1 source does not resolve).
    So the personal question GROUNDS (its real notes), no false downgrade. `TestUsedPathsSuffixMatch`.
  - **R2 body tripwire → gap-admission:** a would-be-generic card whose body narrates the owner's own
    experience (SINGULAR first person I/my/mine, or a YYYY-MM-DD date) is replaced by a gap-admission,
    never shipped with a lying marker. Preamble before the `**Key:` line is dropped first (the model's
    "…so I'll answer generally" is meta, not a personal account). Inclusive "we"/"our" and naming a
    project to DENY it (a gap-admission must) are NOT tripwires — they false-positived on generic
    advice and on gapCase. `TestFinalizePersonalBodyGapAdmission`.
  - **R3 canonical marker:** the server strips any marker variant (underscore/asterisk/bare) and
    stamps one canonical `_General — not from your notes._`. `TestFinalizeMarkerCanonical`.
  - **R4 citation downgrade signal:** `assistant.cue` citation adds `downgrade`
    (marker_present | used_unmatched | used_empty | first_person | date). **R5** prompt: generic
    answers use a general voice (no first person, no own-project names, no dates).
  8 clean full-set runs (claude-haiku-5-5); every card two-state, V4 grounds via R1.
- **Experience question vs how-to (v0.1.175, follow-up #3).** The body fix still mislabelled a
  personal-EXPERIENCE question ("tell me about a time something broke on your own systems"): the
  model grounded on PROJECT notes, the V1 From-gate dropped them (unnamed project), and the STAR body
  — no literal `I`, no date — shipped under a generic marker. V1 wants a how-to to drop an adjacent
  project; an experience question wants to KEEP it (the project IS the answer). The deterministic
  signal is the QUESTION's shape, not the body: `storyRE` ("tell me about a time …", "walk me through
  a time …") marks an experience question, and `citedFrom` keeps a project note when the question is
  a story (or named it, G2); a how-to still drops an adjacent unnamed project (V1). `Prompt.question`
  is threaded in. The body tripwire still catches STAR / commit-hash stories so an ungrounded story
  becomes a gap-admission, not a lying marker; `citation.downgrade` gains `project_filtered`.
  Verified live: the incident question grounds on its project note across 8 full-set runs, zero
  deterministic failures. Guards: `TestFinalizeStoryQuestionGroundsProject`,
  `TestFinalizeHowToDropsUnnamedProject`, `TestFinalizeOrphanNarrativeIsGapAdmission`, `incidentCase`.
  **Known limit:** whether a named-entity question with no record admits the gap by name (proposal C,
  the Larkspur case) is model behaviour the prompt nudges but the server cannot force without reading
  the notes semantically; it flakes ~1/8, like the LLM judge's subjectivity on the generic marker.
- **golden-set case:** `frameCase` in `evalCases()` carries the §0 accident's ORIGINAL question text
  (this is the **F6 / follow-up F-3 fixed regression**). Verified live 2026-10-25 (claude-haiku-5-5,
  4 clean full-set runs): the card leads with interface contract / budgets / staged rollout, USED
  declares `larkspur` + `model-to-production`, the server stamps `_From:_` from those real sources, and
  the methodology node never appears. The eval checks the FINISHED card (post-`stampFrom`), as shipped.

## D2 — gap bridged by a generic word (gap-discipline sibling)

- **question:** "At Larkspur, what detection accuracy — precision and recall — did your model hit on
  the detection task?" (Larkspur has no detection model; "detection" is shared only lexically with an
  unrelated Harborpay fraud-rules engine.)
- **card gist / risk:** presenting Harborpay's work AS the Larkspur metric, or a scripted counter-
  question instead of admitting the gap.
- **grounding nodes:** `larkspur` (the named project); the lure is `harborpay` via the generic word.
- **scene:** technical round. **Class: F2 (gap violation) / G2 (cross-experience bridge).**
- **status:** CLOSED. **fix:** admit the gap; the named-project domain gate excludes another project's
  notes; a counter-question counts as a dodge only when it REPLACES the admission (spec §3 note).
- **golden-set case:** `gapCase`. Verified live: admits "not in your notes", pulls in no Harborpay
  bridge; judge passes.

## D3 — process question not using the posted band (layered-grounding sibling)

- **question:** "What are your salary expectations for this role?" (the posting carries a band.)
- **risk:** falling back to "not in your notes" instead of using the posted band.
- **scene:** general round. **Class: F3 (layer not exhausted) / H2 (process facts).**
- **status:** CLOSED. **fix:** process questions answer from the packet's posted band + role notes.
- **golden-set case:** `processCase`. Verified live: answer uses the $180k–$220k band.

---

## Pattern watch (§8)

When ≥3 closed defects drift toward the same material cluster, the fix is a retrieval/domain-gate
change, not per-card handling. So far one cluster has shown gravity: the **AI/testing-methodology**
cluster (D1) — lexically dense and self-framing. Watch for repeats; if D-rows accumulate there, make
the domain gate classify question-domain structurally rather than lean on the generation-side lead
discipline alone.

**2026-10-25 correction to the method itself:** D1 proved a drift's source can be the PROMPT (a
few-shot example), not retrieval — so when a frame appears on the card, always run `debug=true` and
check whether the frame's words were actually fed (they were not, for D1). If a frame is not in the
fed context, do not touch retrieval; fix the prompt. And a `From:` line a model writes is rhetoric,
not grounding: the server now stamps it from the real sources (`stampFrom`), so any future ledger
row can trust the card's From as a true record of what was fed.
