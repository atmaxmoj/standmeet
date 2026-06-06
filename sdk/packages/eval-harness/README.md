# @standmeet/eval-harness

CLI eval harness for StandMeet's visitor agent. Spawn the real
`@standmeet/agent-core` `VisitorAgent` against fs / canned / direct-LLM
adapters, run YAML scenarios, print transcripts.

**No backend, no Next.js, no Postgres, no Redis, no docker.** Pure Node.

## Why

Owner / another agent can read a transcript and audit:

- prompt quality (system prompt fragment composition)
- agent behavior (when does it search vs. read vs. give up?)
- state transitions (tool fail → retry / re-plan / cascade)
- markdown / LaTeX / mermaid rendering (output an HTML file per scenario)

## Quickstart

```sh
# 1. fill in API keys (any one of DEEPSEEK / ANTHROPIC / OPENAI / GOOGLE)
cp sdk/packages/eval-harness/.env.example sdk/packages/eval-harness/.env

# 2. build
pnpm --filter @standmeet/eval-harness build

# 3. run wiring smoke (no real LLM)
pnpm --filter @standmeet/eval-harness exec eval-harness run \
  sdk/packages/eval-harness/scenarios/smoke-scripted.yml
```

## Scenarios

YAML files under `scenarios/`. Shape:

```yaml
scenario: visitor-asks-projects
description: visitor 问 owner 项目；agent 该 search + read + summarize
prompts:
  - visitor-header
  - capabilities/corpus.retrieval
capabilities:
  corpus.retrieval:
    enabled: true
toolSpecs:
  corpus.retrieval:
    - name: corpus.search
      description: Search the owner's curated corpus.
      input_schema: { type: object, properties: { query: { type: string } } }
tools:
  corpus.search: { fixture: corpus-sample.json, op: search }
user: tell me about your projects
model: deepseek-chat            # F.2 land 后才支持；F.1 走 scripted
```

`model:` 字段决定走哪个 provider；F.1 阶段不支持 `model:`，要么写
`scripted: { steps: [...] }` (mock LLM)，要么等 F.2 land。

## Architecture

5 DI ports from `@standmeet/agent-core`，eval-harness 各注一份本地 impl：

| Port | Adapter (eval-harness) | 用途 |
|---|---|---|
| `PromptSource` | `fsPromptSource` | `fs.readFile backend/internal/prompts/<id>.md` |
| `CapabilityStateSource` | `staticCapabilityStateSource` | YAML 写死常量 |
| `LLMStreamer` | `scriptedLLMStreamer` / direct-LLM (F.2) | scripted steps 或真 provider |
| `ToolDispatcher` | `cannedToolDispatcher` | 查 fixtures/*.json |
| `EventObserver` | `printObserver` | 彩色 stdout + 可选 JSONL |

**关键约束**：agent loop / prompt fragment / tool spec 跟 prod **一字不差**。
eval-harness 只动 host-side 入口，不动 agent core 逻辑。

## CLI

```
eval-harness run <scenario.yml> [options]

Options:
  --json <path>          也写 JSONL 行到 path (一行一 event)
  --no-color             stdout 不带 ANSI 着色
  --prompt-root <path>   PromptSource 根目录 (默认 backend/internal/prompts)
  --fixture-root <path>  ToolDispatcher fixture 根目录 (默认 scenarios/../fixtures)
```

## Roadmap

- ✅ F.1 — package scaffold + scripted LLM smoke (this commit)
- ⏳ F.2 — direct-LLM adapters (DeepSeek / Anthropic / OpenAI / Google)
- ⏳ F.3 — markdown HTML output (no React; unified pipe gfm + math + katex + mermaid + sanitize)
- ⏳ F.4 — 5-8 starter scenarios (visitor-asks-projects, visitor-books-meeting, visitor-jailbreak-attempt, ...)
- ⏳ F.5 — `--grep` batch + summary table
