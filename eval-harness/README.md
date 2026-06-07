# eval-harness

A stack for **sampling and testing the owner's agent system prompt** — the
prompt that makes the visitor agent answer in the owner's voice, grounded in
the owner's corpus. It exposes that agent as a callable "answer this question"
function so an interviewer can drive it turn by turn and judge the answers.

It's its own Go module (own `go.mod`, `replace → ../backend`) and imports only
the public facade `github.com/atmaxmoj/standmeet/agentcore`. It never touches
`internal/`. The loop it runs is byte-for-byte the same eino ADK loop the HTTP
path (`RunAgentTurn`) runs — so what you observe is real prod behaviour.

## The idea

- **Under test** = the owner's system prompt (`fixtures/personas/<name>/system.md`)
  + their corpus. Here the persona is *Marcus Chen*, a deliberately mid-level
  fictional engineer with a rich hand-written corpus (jobs, project deep-dives,
  an incident postmortem, honest skill gaps, opinions, doubts) so an interview
  has genuine quality signal.
- **The candidate** = that prompt + corpus running on a real LLM (DeepSeek
  v4-pro), answering via real `corpus_search` / `corpus_read`.
- **The interviewer** = a **Claude agent the operator spawns** (not part of this
  binary, and not a hand-written prompt). It reads the corpus as ground truth,
  conducts a multi-turn interview by calling `--ask` repeatedly, and judges each
  answer for grounding / voice / hallucination — surfacing where the owner's
  prompt fails so it can be iterated.

The harness's whole job is the candidate side. Prompts are **injected, not
hard-coded**: the candidate prompt is a per-persona file; the interviewer is the
spawned agent itself.

## `--ask` — one candidate turn (the interface interviewers drive)

Reads an `askRequest` JSON on stdin, writes an `askResponse` on stdout. One
process = one turn. Self-reads DeepSeek creds from `.env` (see `.env.example`).

```sh
echo '{"history":[],"question":"Walk me through your hardest project."}' \
  | ./eval-harness --ask --persona fixtures/personas/marcus-chen
```

```jsonc
// askResponse
{
  "answer": "Yeah, the one I'm proudest of is the reconciliation pipeline at FlowPay…",
  "tools":  [ {"name":"corpus_search","args":"{\"query\":\"hardest project\"}"},
              {"name":"corpus_read","args":"{\"uri\":\"wiki://project/order-reconciliation\"}"} ]
}
```

`history` is the interview so far (`[{"role":"interviewer"|"candidate","text":…}]`);
`question` is the new interviewer line. `tools` shows which corpus entries the
candidate consulted, so the interviewer can check it didn't answer from thin air.

A spawned interviewer agent loops: ask → read the JSON answer → check it against
the corpus → ask the next (follow-up) question with the grown `history` → … then
reports the prompt's failure modes.

## Credentials

The stack self-configures from `eval-harness/.env` (gitignored; copy
`.env.example`). Priority: `EVAL_KEY` → `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` /
`ANTHROPIC_API_KEY` → deterministic mock gateway. Startup logs
`provider=… endpoint=… model=…` (never the key).

## Deterministic plumbing test (no key)

`make eval-smoke` proves the candidate loop is independently callable + the
corpus tool round-trip works, against the dev mock gateway — no real LLM.
`--scenarios <dir>` runs YAML scenarios (human transcript or `--json` JSONL).

## Layout

```
eval-harness/
├─ main.go            dispatch: ask / batch / ad-hoc
├─ ask.go             the candidate interface (--ask): one turn, JSON in/out
├─ corpus.go          load persona corpus, real keyword search + read tools
├─ capture.go         capture the candidate's answer + corpus tools it used
├─ scenario.go/runner.go/format.go/jsonl.go/transcript.go   deterministic test path
├─ env.go             self-read .env + resolve LLM cred
├─ fixtures/personas/marcus-chen/
│  ├─ system.md       the owner-voice system prompt UNDER TEST (injectable)
│  └─ corpus/         the persona's corpus (wiki/ + raw/)
└─ scenarios/         starter YAML scenarios for the deterministic path
```
