// real-setup.ts —— /dev/agent-real 用真后端 + 真 browser adapters。
//
// 装配链:
//   - httpPromptSource: GET /api/v1/prompts/{id}
//   - zustandCapabilityStateSource: 从 useCapabilityStore 读
//   - httpInferenceStreamer: POST /api/v1/inference/stream SSE
//   - httpToolDispatcher: POST /sessions/{conv_id}/tools/{name}
//   - useAgent: 跑 VisitorAgent loop
//
// 跟 prod visitor chat 用的是同一套 adapter；这个 dev route 是 e2e
// 验证 pi 链路真打通的最小 host (不需要碰 visitor chat UI)。

import {
  httpPromptSource, httpToolDispatcher, httpInferenceStreamer,
} from '@standmeet/sdk';
import type {
  CapabilityState, LLMToolSpec, ToolSpecRegistry, VisitorAgentPorts,
} from '@standmeet/agent-core';

import { zustandCapabilityStateSource, useCapabilityStore } from '@/lib/visitor/capability-store';

// browser 走相对路径，Next rewrites 转给 backend。
const APP_BACKEND = '';

export interface RealSetupCfg {
  sessionToken: string;
  conversationID: string;
}

export const REAL_SYSTEM_PARTS = ['visitor-header'] as const;

// CORPUS_TOOL_REGISTRY —— 这个 dev route 只暴露 corpus_search/read/list；
// prod 装的时候按 owner role 拿到的 tool_specs 注册。
export const REAL_TOOL_REGISTRY: ToolSpecRegistry = {
  forCapability(id: string): readonly LLMToolSpec[] {
    return id === 'corpus.retrieval' ? CORPUS_TOOL_SPECS : [];
  },
};

const CORPUS_TOOL_SPECS: readonly LLMToolSpec[] = [
  {
    name: 'corpus_search',
    description: 'Search owner corpus by keyword.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'corpus_read',
    description: 'Read one corpus entry by path.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'corpus_list',
    description: 'List corpus entries by prefix.',
    input_schema: {
      type: 'object',
      properties: { prefix: { type: 'string' } },
    },
  },
];

export function buildRealPorts(cfg: RealSetupCfg): Omit<VisitorAgentPorts, 'observer'> {
  return {
    prompts: httpPromptSource({ baseURL: APP_BACKEND }),
    capabilities: zustandCapabilityStateSource(),
    llm: httpInferenceStreamer({
      baseURL: APP_BACKEND, sessionToken: cfg.sessionToken,
    }),
    tools: httpToolDispatcher({
      baseURL: APP_BACKEND, sessionToken: cfg.sessionToken,
      conversationID: cfg.conversationID,
    }),
  };
}

// seedCapabilityStateFromSession —— 给定 POST /sessions 响应里拿到的
// capabilities 数组，写进 store。也支持任何 tool dispatcher 响应回填
// (cascade 同步)。
export function seedCapabilityStore(states: readonly CapabilityState[]): void {
  useCapabilityStore.getState().setStates(states);
}
