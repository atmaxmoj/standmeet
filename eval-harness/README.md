# eval-harness

An independent stack that drives the backend's **agentic loop** out-of-process
to observe how the visitor agent actually behaves — its prompt, its tool use,
and the **quality of a real conversation**.

It's its own Go module (own `go.mod`, `replace → ../backend`) and imports only
the public facade `github.com/atmaxmoj/standmeet/agentcore`. It never touches
`internal/`. The loop it runs is byte-for-byte the same eino ADK loop the HTTP
path (`RunAgentTurn`) runs — so what you observe is real prod behaviour, not a
re-implementation.

## The main scenario: a simulated interview

The headline use is **simulating a full job interview and watching the agent's
conversation quality**:

- A **mid-level fictional engineer**, *Marcus Chen*, with a rich hand-written
  corpus (`fixtures/personas/marcus-chen/`, ~18 entries: jobs, project
  deep-dives, an incident postmortem, honest skill gaps, opinions, career
  doubts). He's deliberately *mid* — competent, with real limits and unresolved
  doubts — so the interview has genuine quality signal.
- An **LLM interviewer** that asks real questions for a role and **follows up
  dynamically** over ~30–60 minutes (many exchanges), probing vague claims.
- The **candidate** = the backend agentic loop answering *as Marcus, in his
  voice*, grounded in his corpus via real `corpus_search` / `corpus_read`.

Both sides run through the same `agentcore.RunAgentLoop`; they differ only in
system prompt, tools, and role-mirrored history. We **don't assert pass/fail** —
we print the transcript for a human (or another agent) to judge.

### Run a real interview

Needs a real LLM. Point `EVAL_*` at a provider (DeepSeek shown):

```sh
EVAL_PROVIDER=deepseek \
EVAL_ENDPOINT=https://api.deepseek.com \
EVAL_MODEL=deepseek-chat \
EVAL_KEY=sk-... \
make eval-interview EXCHANGES=14 ROLE="senior backend engineer"
```

Without `EVAL_*` it hits the dev mock gateway and only the loop *structure*
runs (content is mock filler — no quality signal). Bring the gateway up first
with `make gateway-up` if you want that structural dry-run.

## Other modes

- **ad-hoc** — one turn from flags, against the deterministic mock gateway.
  Used by `make eval-smoke`.
  ```sh
  ./eval-harness --user "tell me about your hardest project" \
    --corpus fixtures/personas/marcus-chen
  ```
- **batch** — run a directory of YAML scenarios, print a summary tally.
  ```sh
  ./eval-harness --scenarios scenarios --grep visitor      # human transcript
  ./eval-harness --scenarios scenarios --json              # JSONL for tooling
  ```

## Make targets

| target | what |
|--------|------|
| `make eval-smoke` | deterministic smoke: facade is independently callable + tool round-trip + batch scenarios (mock gateway, no key) |
| `make eval-interview` | the main scenario — a full simulated interview (set `EVAL_*` for a real LLM) |

## Layout

```
eval-harness/
├─ main.go            dispatch: ad-hoc / batch / interview
├─ agentcore via facade — the loop
├─ interview.go       the two-LLM interview loop + role mirroring
├─ prompts.go         interviewer + candidate (owner-voice) system prompts
├─ corpus.go          load persona md, real keyword search + read tools
├─ scenario.go        YAML scenario loading + grep
├─ runner.go          batch runner + gateway scripting
├─ format.go/jsonl.go/transcript.go/capture.go   output sinks
├─ fixtures/personas/marcus-chen/   the persona corpus (wiki/ + raw/)
└─ scenarios/         starter YAML scenarios
```
