// llm-scripted.ts —— LLMStreamer adapter: scenario.scripted.steps 顺序返
// 事件，不打真 LLM。
//
// 用途：
//   1. F.1 wiring smoke (证 5 个 port 接上即可，不验真模型行为)
//   2. md-latex-mermaid-render scenario (mock LLM 返写死 markdown，纯渲染管线验证)
//   3. 调试 tool-call 流程时 fixture 准确的 toolCalls 数组

import type {
  LLMStreamEvent,
  LLMStreamRequest,
  LLMStreamer,
} from '@standmeet/agent-core';

import type { ScenarioScripted } from '../scenario.js';

export function scriptedLLMStreamer(steps: ScenarioScripted): LLMStreamer {
  let cursor = 0;
  return {
    stream(req: LLMStreamRequest): AsyncIterable<LLMStreamEvent> {
      void req;
      const step = steps.steps[cursor] ?? { text: 'done.' };
      cursor++;
      return streamOneStep(step);
    },
  };
}

async function* streamOneStep(
  step: ScenarioScripted['steps'][number],
): AsyncIterable<LLMStreamEvent> {
  if (step.text !== undefined) {
    for (const chunk of chunkText(step.text)) {
      yield { type: 'text', delta: chunk };
      await Promise.resolve();
    }
  }
  if (step.toolCalls && step.toolCalls.length > 0) {
    for (const call of step.toolCalls) {
      yield { type: 'tool_call', call };
    }
    yield { type: 'done', stopReason: 'tool_use' };
    return;
  }
  yield { type: 'done', stopReason: 'end_turn' };
}

// chunkText —— text → 16-char 块，模拟真 LLM stream 的 delta 节奏。
function chunkText(text: string, size = 16): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }
  return out;
}
