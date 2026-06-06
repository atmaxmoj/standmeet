// tools-canned.ts —— ToolDispatcher adapter: scenario.tools 里指定
// {fixture, op} → 读 fixtures/{fixture} JSON → 按 op 查表 → 返 ToolResult。
//
// fixture 形态 (corpus-sample.json 等):
//   {
//     "search": { "queryA": [{...hit}, ...], "queryB": [...] },
//     "read":   { "wiki://path/foo": {...content} },
//     "list":   { "wiki://": [{...item}, ...] }
//   }
//
// op 是 fixture 第一级 key (search/read/list/...)。tool call args 决定查
// 哪个子 key（默认按 args 里第一个 string 字段作 key）。

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import type {
  ToolCall,
  ToolDispatcher,
  ToolResult,
} from '@standmeet/agent-core';

import type { Scenario } from '../scenario.js';

export interface CannedToolDispatcherOptions {
  readonly fixtureRoot: string;
  readonly scenario: Scenario;
}

export function cannedToolDispatcher(
  opts: CannedToolDispatcherOptions,
): ToolDispatcher {
  const cache = new Map<string, unknown>();
  function dispatch(call: ToolCall): ToolResult {
    const binding = opts.scenario.tools[call.name];
    if (!binding || !binding.fixture || !binding.op) {
      return failResult(call, `no fixture bound for tool ${call.name}`);
    }
    try {
      const fixture = loadFixture(opts.fixtureRoot, binding.fixture, cache);
      const opMap = pickOp(fixture, binding.op);
      const value = pickByArgs(opMap, call.args);
      return okResult(call, value);
    } catch (err) {
      return failResult(call, (err as Error).message);
    }
  }
  return {
    call(call: ToolCall): Promise<ToolResult> {
      return Promise.resolve(dispatch(call));
    },
  };
}

function loadFixture(root: string, name: string, cache: Map<string, unknown>): unknown {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const path = join(resolve(root), name);
  const raw = readFileSync(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  cache.set(name, parsed);
  return parsed;
}

function pickOp(fixture: unknown, op: string): Record<string, unknown> {
  if (typeof fixture !== 'object' || fixture === null) {
    throw new Error(`fixture root not object`);
  }
  const value = (fixture as Record<string, unknown>)[op];
  if (typeof value !== 'object' || value === null) {
    throw new Error(`fixture has no op ${op}`);
  }
  return value as Record<string, unknown>;
}

// pickByArgs —— call.args 第一个 string 字段值当 lookup key (e.g.
// search({query:"projects"}) → opMap["projects"])。没匹配返 opMap 整体
// （让 fixture 也能写成不区分 args 的"任意调用都返这个"形态）。
function pickByArgs(opMap: Record<string, unknown>, args: unknown): unknown {
  if (typeof args !== 'object' || args === null) return opMap;
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(opMap, v)) {
      return opMap[v];
    }
  }
  return opMap;
}

function okResult(call: ToolCall, value: unknown): ToolResult {
  return {
    id: call.id,
    name: call.name,
    ok: true,
    result: value,
  };
}

function failResult(call: ToolCall, reason: string): ToolResult {
  return {
    id: call.id,
    name: call.name,
    ok: false,
    reason,
  };
}
