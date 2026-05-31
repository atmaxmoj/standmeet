// spike-setup.ts —— /dev/agent-spike 的 agent-core 装配。
// 拆出 .ts 让 .tsx 只剩 presentation；这边可以放 if / factory 等
// 真正的"非渲染"逻辑。

import { scriptedLLMStreamer, type ScriptedStep } from '@standmeet/sdk';
import type {
  AgentEvent,
  CapabilityState,
  CapabilityStateSource,
  PromptSource,
  ToolCall,
  ToolDispatcher,
  ToolResult,
  ToolSpecRegistry,
  VisitorAgentPorts,
} from '@standmeet/agent-core';

// eventLabel —— 渲染层只 read，不分支；helper 留 .ts 让 lint 放过。
export function eventLabel(ev: AgentEvent): string {
  const tail = ev.type === 'final_text' ? `: ${ev.text}` : pickEventDetail(ev);
  return ev.type + tail;
}

function pickEventDetail(ev: AgentEvent): string {
  if ('call' in ev) return `: ${ev.call.name}`;
  if ('name' in ev) return `: ${ev.name}`;
  return '';
}

export const SPIKE_CAPS: readonly CapabilityState[] = [
  { id: 'corpus.retrieval', enabled: true },
];

export const SPIKE_SYSTEM_PARTS = ['visitor-header'] as const;

const PROMPT_FIXTURES: Record<string, string> = {
  'visitor-header': 'You are answering visitor questions on behalf of the owner.',
};

export const SPIKE_TOOL_REGISTRY: ToolSpecRegistry = {
  forCapability(id: string) {
    return id === 'corpus.retrieval'
      ? [{
        name: 'corpus_search',
        description: 'Search the owner corpus for a keyword.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
      }]
      : [];
  },
};

const SPIKE_STEPS: readonly ScriptedStep[] = [
  {
    toolCalls: [{
      id: 'call-1', name: 'corpus_search',
      args: { query: 'lucerna' },
    }],
  },
  { text: 'I searched and found one entry: projects/lucerna.' },
];

function memoryPromptSource(): PromptSource {
  return {
    load(id: string): Promise<string> {
      const body = PROMPT_FIXTURES[id];
      return body === undefined
        ? Promise.reject(new Error(`unknown prompt ${id}`))
        : Promise.resolve(body);
    },
  };
}

function staticCapSource(caps: readonly CapabilityState[]): CapabilityStateSource {
  return { current: () => caps };
}

function fakeToolDispatcher(): ToolDispatcher {
  return {
    call(call: ToolCall): Promise<ToolResult> {
      return Promise.resolve({
        id: call.id, name: call.name, ok: true,
        result: [{ path: 'projects/lucerna', title: 'Lucerna', kind: 'wiki' }],
        capability_state: SPIKE_CAPS,
      });
    },
  };
}

// SPIKE_PORTS —— module-scope singleton so React doesn't have to useMemo
// it. Adapters are stateless (no per-render token); scripted streamer is
// the only stateful one but cursor advances by send call which is fine.
export const SPIKE_PORTS: Omit<VisitorAgentPorts, 'observer'> = {
  prompts: memoryPromptSource(),
  capabilities: staticCapSource(SPIKE_CAPS),
  llm: scriptedLLMStreamer({ steps: SPIKE_STEPS }),
  tools: fakeToolDispatcher(),
};
