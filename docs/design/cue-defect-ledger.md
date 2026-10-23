# Cue defect ledger (cue-defect-loop §2 / §8)

The persisted record of every closed cue-card defect. The spec (`cue-defect-loop`) asks for two things
this file holds: a durable ledger (§8) and the golden-set that L3 regression re-runs (§5.2).

- **Executable golden set (§5.2):** `backend/internal/owner/jobs/cues/cue_eval_internal_test.go`,
  `evalCases()` — one case per closed defect, each carrying the defect's original question verbatim
  and its §6 fit check. Run it (`CUE_EVAL=1 … -run TestCueEval`, PII-free synthetic persona) as the
  L3 golden-set regression; it must stay all-green. **Add a case here and there when a defect closes.**
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
  retrieval was pulled there and generation stated that frame as the answer. **Class: F1 (wrong-node
  drift) + F4 (frame mismatch).**
- **status:** CLOSED.
- **fix (surface, not the question — spec §4):** generation-side discipline "the lead must restate
  the question's real referent" (`cuesDiscipline`, F1/F4 branch), plus a sample-card frame warning and
  the structural named-project domain gate (G2). No node blacklist, no per-question patch.
- **golden-set case:** `frameCase` in `evalCases()`. Verified live 2026-10-22 (claude-haiku-5-5): the
  card now leads with interface contract / latency budget / staged rollout, grounded in
  `model-to-production` + Larkspur, never the methodology node. §6 (a) referent + (b) domain pass.

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
