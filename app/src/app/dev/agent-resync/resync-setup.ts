// resync-setup.ts —— capability state cascade 不变量演示。
//
// 场景：role 含 calendar.book (quota_remaining=1) + corpus.retrieval。
// LLM 第 1 轮决定调 calendar_book；tool_result 返新 cap state
// (calendar.book 已 absent — 已 burn 满)；第 2 轮 LLM 看到的 tool list
// 不再含 calendar_book，只剩 corpus_search → 调 search → 第 3 轮 done。
//
// 这是 D 期"拒了返新 state → 前端 zustand 强制同步 → pi 重装配 tool"
// 不变量的演示版。eval harness 之后会用真 LLM 跑相同 scenario。

import { scriptedLLMStreamer, type ScriptedStep } from '@standmeet/sdk';
import type {
  CapabilityState,
  CapabilityStateSource,
  PromptSource,
  ToolCall,
  ToolDispatcher,
  ToolResult,
  ToolSpecRegistry,
  VisitorAgentPorts,
} from '@standmeet/agent-core';

const CAPS_BEFORE: readonly CapabilityState[] = [
  { id: 'calendar.book', enabled: true, quota_remaining: 1 },
  { id: 'corpus.retrieval', enabled: true },
];

const CAPS_AFTER_BURN: readonly CapabilityState[] = [
  // calendar.book absent after burn — Registry gating hid it.
  { id: 'corpus.retrieval', enabled: true },
];

export const RESYNC_SYSTEM_PARTS = ['visitor-header'] as const;

const PROMPT_FIXTURES: Record<string, string> = {
  'visitor-header': 'You are answering visitor questions on behalf of the owner.',
};

export const RESYNC_TOOL_REGISTRY: ToolSpecRegistry = {
  forCapability(id: string) {
    if (id === 'calendar.book') return [{
      name: 'calendar_book',
      description: 'Book a meeting.',
      input_schema: { type: 'object', properties: { topic: { type: 'string' } } },
    }];
    if (id === 'corpus.retrieval') return [{
      name: 'corpus_search',
      description: 'Search the corpus.',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    }];
    return [];
  },
};

// scripted LLM —— 第 1 步 call calendar_book，第 2 步 (LLM 已经看不见
// calendar_book) call corpus_search 替代，第 3 步 final text。
const RESYNC_STEPS: readonly ScriptedStep[] = [
  { toolCalls: [{ id: 'c1', name: 'calendar_book', args: { topic: 'intro' } }] },
  { toolCalls: [{ id: 'c2', name: 'corpus_search', args: { query: 'lucerna' } }] },
  { text: 'Booked the meeting and pulled context.' },
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

// mutableCapSource —— current() 在 burn 前返 CAPS_BEFORE，burn 后返
// CAPS_AFTER_BURN。dispatcher 调用时主动切换。caller 调 reset() 让
// scenario 可重跑。
export interface MutableCapSource extends CapabilityStateSource {
  setBurned(): void;
  reset(): void;
}

export function mutableCapSource(): MutableCapSource {
  let burned = false;
  return {
    current: () => burned ? CAPS_AFTER_BURN : CAPS_BEFORE,
    setBurned: () => { burned = true; },
    reset: () => { burned = false; },
  };
}

export function resyncToolDispatcher(capSource: MutableCapSource): ToolDispatcher {
  return {
    call(call: ToolCall): Promise<ToolResult> {
      if (call.name === 'calendar_book') {
        capSource.setBurned();
        return Promise.resolve({
          id: call.id, name: call.name, ok: true,
          result: { ok: true, event_id: 'evt-1' },
          capability_state: CAPS_AFTER_BURN,
        });
      }
      // corpus_search after burn — cap state stays AFTER_BURN
      return Promise.resolve({
        id: call.id, name: call.name, ok: true,
        result: [{ path: 'projects/lucerna' }],
        capability_state: CAPS_AFTER_BURN,
      });
    },
  };
}

// RESYNC_PORTS factory —— scenario 内部有状态 (mutableCapSource +
// scripted cursor)。每次 mount 新建一份让 spec 可重跑。
export function makeResyncPorts(): {
  ports: Omit<VisitorAgentPorts, 'observer'>;
  capSource: MutableCapSource;
} {
  const capSource = mutableCapSource();
  const ports: Omit<VisitorAgentPorts, 'observer'> = {
    prompts: memoryPromptSource(),
    capabilities: capSource,
    llm: scriptedLLMStreamer({ steps: RESYNC_STEPS }),
    tools: resyncToolDispatcher(capSource),
  };
  return { ports, capSource };
}
