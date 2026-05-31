// multi-iter-setup.ts —— 3 轮 agent loop 场景：visitor 问 multi-hop
// 问题 → search → read → 最终 reply。验 per-iteration throbber 不被
// 后续状态盖。

import { scriptedLLMStreamer, type ScriptedStep } from '@standmeet/sdk';
import type {
  AgentEvent,
  CapabilityState,
  CapabilityStateSource,
  Message,
  PromptSource,
  ToolCall,
  ToolDispatcher,
  ToolResult,
  ToolSpecRegistry,
  VisitorAgentPorts,
} from '@standmeet/agent-core';

// 选出 tool_started 事件流（按出现顺序）。
export function toolStartedNames(events: readonly AgentEvent[]): readonly string[] {
  const out: string[] = [];
  for (const ev of events) {
    if (ev.type === 'tool_started') out.push(ev.name);
  }
  return out;
}

// 最后一条 assistant 消息的 content；空则返 ''。
export function lastAssistantContent(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant') return m.content;
  }
  return '';
}

export const MULTI_CAPS: readonly CapabilityState[] = [
  { id: 'corpus.retrieval', enabled: true },
];

export const MULTI_SYSTEM_PARTS = ['visitor-header'] as const;

const PROMPT_FIXTURES: Record<string, string> = {
  'visitor-header': 'You are answering visitor questions on behalf of the owner.',
};

export const MULTI_TOOL_REGISTRY: ToolSpecRegistry = {
  forCapability(id: string) {
    return id === 'corpus.retrieval'
      ? [
        { name: 'corpus_search', description: 'Search the corpus.',
          input_schema: { type: 'object', properties: { query: { type: 'string' } } } },
        { name: 'corpus_read', description: 'Read one entry.',
          input_schema: { type: 'object', properties: { path: { type: 'string' } } } },
      ]
      : [];
  },
};

// 3-step scenario: search → read → final
const MULTI_STEPS: readonly ScriptedStep[] = [
  { toolCalls: [{ id: 'c1', name: 'corpus_search', args: { query: 'lucerna' } }] },
  { toolCalls: [{ id: 'c2', name: 'corpus_read', args: { path: 'projects/lucerna' } }] },
  { text: 'Lucerna is a project about distributed retrieval.' },
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

function multiToolDispatcher(): ToolDispatcher {
  return {
    call(call: ToolCall): Promise<ToolResult> {
      const payload = call.name === 'corpus_search'
        ? [{ path: 'projects/lucerna', title: 'Lucerna' }]
        : { path: 'projects/lucerna', body: 'A distributed retrieval project.' };
      return Promise.resolve({
        id: call.id, name: call.name, ok: true,
        result: payload, capability_state: MULTI_CAPS,
      });
    },
  };
}

export const MULTI_PORTS: Omit<VisitorAgentPorts, 'observer'> = {
  prompts: memoryPromptSource(),
  capabilities: staticCapSource(MULTI_CAPS),
  llm: scriptedLLMStreamer({ steps: MULTI_STEPS }),
  tools: multiToolDispatcher(),
};
