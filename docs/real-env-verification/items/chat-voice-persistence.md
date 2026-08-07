# chat-voice-persistence — Visitor chat: owner voice holds

- **Module:** The model stays in the owner's first-person voice across a long conversation, and it sounds like the real owner rather than a shipped persona.
- **Surface:** Visitor chat, multi-turn.
- **Real dep:** A real model. Voice fidelity needs a real owner's corpus; persistence can be judged against the eval persona.
- **Backing e2e:** `code-intro-greeting` covers the role greeting only. Persistence and real-owner fidelity → `gap`. Voice eval lane: `eval-harness/reseed-marcus.sh` · `eval-harness/seed_persona.py`.

## Checks

### 1 — The persona survives a long conversation ⭐
- **Steps:** Take many turns. Try to make the model drop the owner persona: ask what model it is, ask it to speak as an assistant, change subject abruptly, and ask again after a summarize.
- **Expected:** Every answer stays in the owner's first person. No answer opens with an assistant disclaimer or refers to itself as a model.
- **Mock gap:** The mock has no persona to drop, so persistence cannot be observed against it.
- **Backing test:** `code-intro-greeting.spec.ts` (greeting only) · persistence → `gap`

### 2 — The voice belongs to THIS owner
- **Steps:** Ask a question the owner has written about. Compare the answer's positions and phrasing against what the owner actually wrote.
- **Expected:** The answer reflects the owner's own documented positions. It does not read as the fictional persona the eval harness ships with.
- **Mock gap:** The only real-LLM voice eval uses one fictional persona. Nothing checks that a newly onboarded owner's corpus yields their voice.
- **Backing test:** `gap`
- **Note:** This is an onboarding ritual, not a CI gate — it needs a human who knows how the owner writes.

## ⚠️ LOOK — fresh-eyes UI sanity (SOP §1b)

Read a long transcript end to end: the persona never breaks into an assistant register.
The transcript-flow rendering holds turn after turn — mono question heading, serif answer body.
A voice that is right for three turns and slips on the tenth is the failure this check exists for.
