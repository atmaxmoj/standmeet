// runner.ts —— scenario YAML → 装 5 个 port → 跑 VisitorAgent → return transcript meta。
//
// runScenario 不 throw scenario 自身的失败 (LLM error / tool error 等)；
// transcript 收到 error event 即可。CLI 拿 status code 决定 exit。
//
// system prompt 拼法：scenario.prompts 是 fragment id list；按顺序读 +
// "\n\n" 连。跟 prod backend 的 ComposeSystemPrompt 同语义 (有序拼接)。

import {
  VisitorAgent,
  type LLMStreamer,
  type LLMToolSpec,
  type ToolSpecRegistry,
} from '@standmeet/agent-core';

import type { Scenario } from './scenario.js';
import { fsPromptSource } from './adapters/prompts-fs.js';
import { staticCapabilityStateSource } from './adapters/caps-static.js';
import { cannedToolDispatcher } from './adapters/tools-canned.js';
import { printObserver } from './adapters/observer-print.js';
import { scriptedLLMStreamer } from './adapters/llm-scripted.js';
import { directLLMStreamer } from './adapters/llm-direct.js';

export interface RunScenarioOptions {
  readonly scenario: Scenario;
  readonly promptRoot: string;
  readonly fixtureRoot: string;
  readonly jsonlPath?: string;
  readonly color?: boolean;
  // llmFactory —— 默认按 scenario.model / scenario.scripted 选；test 也可
  // 直接注 streamer (绕开 env key 校验)。
  readonly llmStreamer?: LLMStreamer;
}

export interface RunScenarioResult {
  readonly scenarioName: string;
  // hasError —— 任何 'error' event 落下都 true；CLI 用此返非 0 exit code。
  readonly hasError: boolean;
}

export async function runScenario(opts: RunScenarioOptions): Promise<RunScenarioResult> {
  const { scenario } = opts;
  const prompts = fsPromptSource({ root: opts.promptRoot });
  const capabilities = staticCapabilityStateSource(scenario);
  const tools = cannedToolDispatcher({ fixtureRoot: opts.fixtureRoot, scenario });
  let hasError = false;
  const baseObserver = printObserver({
    color: opts.color, jsonlPath: opts.jsonlPath, startTimeMs: Date.now(),
  });
  const observer = {
    onEvent(e: Parameters<typeof baseObserver.onEvent>[0]): void {
      if (e.type === 'error') hasError = true;
      baseObserver.onEvent(e);
    },
  };
  const llm = opts.llmStreamer ?? pickLLMStreamer(scenario);
  const agent = new VisitorAgent(
    { prompts, capabilities, llm, tools, observer },
    {
      systemPromptPartIDs: [...scenario.prompts],
      toolSpecRegistry: buildToolSpecRegistry(scenario),
    },
  );
  printScenarioHeader(scenario);
  await agent.send({ userMessage: scenario.user });
  return { scenarioName: scenario.scenario, hasError };
}

function printScenarioHeader(scenario: Scenario): void {
  process.stdout.write(`\n═══ scenario: ${scenario.scenario} ═══\n`);
  if (scenario.description) {
    process.stdout.write(`${scenario.description}\n`);
  }
  process.stdout.write(`USER: ${scenario.user}\n`);
}

// pickLLMStreamer —— scenario.scripted 存在 → scripted；scenario.model 存在
// → directLLMStreamer (F.2 接入)；都没设走 "no-op" 兜底 (scripted 'done.'
// reply)，让 wiring smoke 还能跑。
function pickLLMStreamer(scenario: Scenario): LLMStreamer {
  if (scenario.scripted) {
    return scriptedLLMStreamer(scenario.scripted);
  }
  if (scenario.model) {
    return directLLMStreamer({ model: scenario.model });
  }
  return scriptedLLMStreamer({ steps: [{ text: 'eval-harness: no scripted steps configured.' }] });
}

// buildToolSpecRegistry —— scenario.toolSpecs map cap id → tool specs。
// forCapability 在 agent 每轮 toolSpecsForCurrentCaps 时调一次。
function buildToolSpecRegistry(scenario: Scenario): ToolSpecRegistry {
  return {
    forCapability(capabilityID: string): readonly LLMToolSpec[] {
      const specs = scenario.toolSpecs[capabilityID];
      if (!specs) return [];
      return specs.map((s) => ({
        name: s.name,
        description: s.description,
        input_schema: s.input_schema,
      }));
    },
  };
}
