# chat-voice-persistence — Visitor chat: owner voice holds

- **Status:** ⬜ not-run
- **Module:** the model stays in the owner's first-person voice across a long conversation and sounds like a *real* owner (not the shipped fictional persona).
- **Surface:** visitor chat (multi-turn).
- **Real dep:** real DeepSeek + a real owner's corpus (voice fidelity) or the eval persona (persistence).
- **Backing e2e:** `code-intro-greeting` (role greeting only). Persistence / real-owner fidelity → no backing spec (gap). Voice eval lane: `eval-harness/reseed-marcus.sh` · `eval-harness/seed_persona.py`.

## Checks

### 1 — Role persistence across a long conversation  (was §A12)
- **Steps:** over many turns, try to get the model to drop the owner persona / speak as "an AI assistant".
- **Expected:** it stays in the owner's first-person voice throughout.
- **⚠️ mock gap:** the mock has no persona to drop; persistence is untestable against it.
- **Backing test:** `code-intro-greeting.spec.ts:75` (role greeting only). Persistence → no backing spec (gap).
- **Result:** ⬜

### 2 — Voice fidelity for a REAL owner  (was §A20)
- **Steps:** onboard a *real* owner's corpus → run the voice eval against DeepSeek → judge whether the answers sound like that owner.
- **Expected:** a faithful voice from real content (not the fictional `marcus-chen` persona the eval ships with). This is an onboarding ritual, not a CI gate.
- **⚠️ mock gap:** the only real-LLM voice eval uses one fictional persona; no check that a newly onboarded real owner's corpus yields a faithful voice.
- **Backing test:** `eval-harness/reseed-marcus.sh` · `eval-harness/seed_persona.py` (fictional persona only). Real-owner fidelity → no backing spec (gap).
- **Result:** ⬜

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)
Across a long transcript the persona never breaks into "as an AI assistant"; the transcript-flow render (mono Q heading, serif answer body) stays consistent turn after turn.

## Findings
(record here; also log `../findings.md`, ID `F-A-n` historical anchor)

- **Second pass ✅** — first-person owner voice confirmed clean on real DeepSeek (no "as an AI" disclaimer).
