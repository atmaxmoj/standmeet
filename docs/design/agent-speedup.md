# Visitor agent speedup — measurements and decisions

Source: the agent speedup handoff (W1–W5), 2026-10-06. Goal: seconds, not minutes, before a
visitor's answer, with no loss of answer quality. Red lines: no speed bought by checking less;
the work-authorization answer (e) matches the corpus word for word.

## How it is measured

`EVAL_HOST=https://sijie.xyz EVAL_CODE=<code> make eval-speed` (`eval-harness/speed.py`). The
script asks the five regression questions (a–e, `eval-harness/fixtures/speed/questions.json`)
in one visitor session on the real instance. For each question it records the wall time, the
time to the first answer token, and the tools called. Each answer is checked for its required
points (`must`). The script writes a transcript; a person reads every answer against its gold
points. The flash runs below sent the turn request's `model` field. That field was removed
for visitors right after (a visitor must not pick the model the owner pays for); to compare
models now, give the code another provider. The codes used: SPEED-BASE
(hiring role, selftest bundle, default provider) and SPEED-GROQ (the same, provider
groq-free).

## Results (sijie.xyz, 2026-10-07; seconds, per-question median of three runs)

| question | baseline (v0.1.131) | W3 + W2, deepseek-v4-pro | W3 + W2, deepseek-flash |
|---|---|---|---|
| (a) intro + fit | 17.5 | 5.3 | 4.4 |
| (b) MCP for a CRM | 14.9 | 11.7 | 8.2 |
| (c) dependable LLM output | 27.2 | 20.1 | 24.0 |
| (d) weaknesses | 46.6 | 22.2 | 14.8 |
| (e) US work authorization | 8.3 | 4.7 | 3.6 |
| median | 17.5 | 11.7 (−33%) | 8.2 (−53%) |

The baseline is one run. The baseline (e) answer was wrong: zero searches, "my notes don't
cover work authorization". The corpus states it in `subjectivity://background`.

## What shipped

- **W3, hard facts (v0.1.132 + v0.1.133).** A role's exactly named subjectivity notes go into
  every turn's instruction (`conversation/usecase/visitor_profile_facts.go`), within a 16 000
  character budget. The first release read nothing: the ref parser rejected `subjectivity://`.
  `ParseNoteURI` fixed it, and the fix also stops waypoints with subjectivity evidence from
  being dropped. The "agent turn prepared" log line carries `fact_notes_chars` (13 029 for the
  hiring role on sijie.xyz). (a) and (e) now answer with zero searches; (e) is correct.
- **W2, visitor budget (v0.1.134).** A visitor session gets 8 rounds (`visitorAgentIterations`);
  drivers with no visitor session keep 24. Past the budget the turn closes through the existing
  exhaustion synthesis.

## Decided against

- **W1a, groq-free (`openai/gpt-oss-120b`) for the hiring role.** Question (e) alone took 50 s
  (free-tier rate limits), and the five questions did not finish in 10 minutes. The answer also
  broke the red line: it guessed TN / H-1B. Not adopted.

## Open

- **W1, deepseek-flash for visitor turns.** Meets the handoff bar: the median falls by at least
  50%, the required points hold in all runs, and every (e) answer stays inside the red line.
  The instance can only switch the default provider's model, and that change also affects
  summaries and ghosts. The change is the owner's to approve.
- **pro (e) wording.** In one run the pro model named "H-1B" as an example of sponsorship. The
  facts were right, but the example is a guess the red line forbids. flash did not do this.
- **W4 (per-conversation retrieval cache): decided against, 2026-10-07.** `make eval-speed` now
  records the time spent inside tools. On sijie.xyz (v0.1.136, pro) it was 0.4 s of 37 s for (b),
  0.1 s of 17 s for (c), 0.5 s of 33 s for (d). A cache saves at most that half second; the time
  is the model's own rounds. The lever is the model (W1), not retrieval.
- **W5 (landing): measured, nothing to fix, 2026-10-07.** A code bound to a microsite, two fresh
  browsers on sijie.xyz (v0.1.136): `/?code=` → name picker 0.8–0.9 s; name submitted → the
  microsite's chat ready 1.0–1.3 s (`/codes/intro`, `/sessions`, `/session`, `/conversations`
  each well under a second). The 35 s in the handoff does not reproduce.
