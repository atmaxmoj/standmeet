// scenario.ts —— YAML scenario shape + 解析 + 校验。
//
// 数据形态故意保守：YAML 字段 → typed Scenario interface → runner.ts
// 装配 ports。新加字段时先扩这里再扩 adapter，确保 YAML 不漂。
//
// 不靠 zod / valibot —— 这一层窄字段集合手写校验就够了，少一条依赖。

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

// Scenario —— 单个 scenario YAML 的反序列化形态。
export interface Scenario {
  readonly scenario: string;
  readonly description?: string;

  // PromptSource fragment ids (相对 prompts/ 目录)。runner.ts 会
  // fs.readFile 拼成 system prompt。
  readonly prompts: readonly string[];

  // CapabilityStateSource 静态常量：id → {enabled, ...}
  readonly capabilities: Readonly<Record<string, ScenarioCapability>>;

  // ToolDispatcher canned fixture：tool name → fixture lookup
  readonly tools: Readonly<Record<string, ScenarioToolBinding>>;

  // tool spec registry: capability id → list of tools with JSON schema。
  // runner 用此构造 ToolSpecRegistry.forCapability(id)。
  readonly toolSpecs: Readonly<Record<string, readonly ScenarioToolSpec[]>>;

  readonly user: string;

  // LLM provider model id (pi-ai catalog 形态：'deepseek-chat' /
  // 'claude-3-5-sonnet-20241022' / 'gpt-4o' / 'gemini-2.0-flash')。
  // 跟 PROVIDER_BY_MODEL 表对齐，runner 据此选 adapter + env key。
  // 留空走 scripted (静态 reply，不打真 LLM)。
  readonly model?: string;
  readonly scripted?: ScenarioScripted;
}

export interface ScenarioCapability {
  readonly enabled: boolean;
  readonly [k: string]: unknown;
}

export interface ScenarioToolBinding {
  readonly fixture?: string;
  readonly op?: string;
}

export interface ScenarioToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input_schema: unknown;
}

// ScenarioScripted —— model 字段空时跑这条；adapter 按 steps 顺序返事件，
// 不打真 LLM。debugging / wiring smoke / md-render-only scenarios 用。
export interface ScenarioScripted {
  readonly steps: readonly ScenarioScriptedStep[];
}

export interface ScenarioScriptedStep {
  readonly text?: string;
  readonly toolCalls?: readonly ScenarioToolCall[];
}

export interface ScenarioToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

// loadScenario —— 读 + parse + 校验。失败抛 ScenarioInvalidError。
export function loadScenario(path: string): Scenario {
  const raw = readFileSync(path, 'utf-8');
  const data = parseYaml(raw) as unknown;
  return validateScenario(data, path);
}

// ScenarioInvalidError —— 让 CLI 能区分"YAML 格式问题"vs"adapter / LLM
// 故障"，输出更准。
export class ScenarioInvalidError extends Error {
  override name = 'ScenarioInvalidError';
  constructor(readonly file: string, readonly field: string, msg: string) {
    super(`${file}: ${field}: ${msg}`);
  }
}

function validateScenario(raw: unknown, file: string): Scenario {
  if (!isRecord(raw)) {
    throw new ScenarioInvalidError(file, '<root>', 'expected mapping');
  }
  return {
    scenario: requireString(raw, 'scenario', file),
    description: optionalString(raw, 'description'),
    prompts: requireStringArray(raw, 'prompts', file),
    capabilities: requireCapabilitiesMap(raw, file),
    tools: requireToolsMap(raw, file),
    toolSpecs: requireToolSpecsMap(raw, file),
    user: requireString(raw, 'user', file),
    model: optionalString(raw, 'model'),
    scripted: optionalScripted(raw, file),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(rec: Record<string, unknown>, key: string, file: string): string {
  const v = rec[key];
  if (typeof v !== 'string' || v === '') {
    throw new ScenarioInvalidError(file, key, 'required string');
  }
  return v;
}

function optionalString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === 'string' ? v : undefined;
}

function requireStringArray(
  rec: Record<string, unknown>, key: string, file: string,
): readonly string[] {
  const v = rec[key];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new ScenarioInvalidError(file, key, 'required string[]');
  }
  return v;
}

function requireCapabilitiesMap(
  rec: Record<string, unknown>, file: string,
): Readonly<Record<string, ScenarioCapability>> {
  const v = rec['capabilities'];
  if (!isRecord(v)) {
    throw new ScenarioInvalidError(file, 'capabilities', 'required mapping');
  }
  const out: Record<string, ScenarioCapability> = {};
  for (const [id, raw] of Object.entries(v)) {
    if (!isRecord(raw) || typeof raw['enabled'] !== 'boolean') {
      throw new ScenarioInvalidError(file, `capabilities.${id}`, 'expected { enabled: boolean, ... }');
    }
    out[id] = raw as ScenarioCapability;
  }
  return out;
}

function requireToolsMap(
  rec: Record<string, unknown>, file: string,
): Readonly<Record<string, ScenarioToolBinding>> {
  const v = rec['tools'];
  if (v === undefined) return {};
  if (!isRecord(v)) {
    throw new ScenarioInvalidError(file, 'tools', 'expected mapping');
  }
  const out: Record<string, ScenarioToolBinding> = {};
  for (const [name, raw] of Object.entries(v)) {
    if (!isRecord(raw)) {
      throw new ScenarioInvalidError(file, `tools.${name}`, 'expected mapping');
    }
    out[name] = {
      fixture: typeof raw['fixture'] === 'string' ? raw['fixture'] : undefined,
      op: typeof raw['op'] === 'string' ? raw['op'] : undefined,
    };
  }
  return out;
}

function requireToolSpecsMap(
  rec: Record<string, unknown>, file: string,
): Readonly<Record<string, readonly ScenarioToolSpec[]>> {
  const v = rec['toolSpecs'];
  if (v === undefined) return {};
  if (!isRecord(v)) {
    throw new ScenarioInvalidError(file, 'toolSpecs', 'expected mapping');
  }
  const out: Record<string, readonly ScenarioToolSpec[]> = {};
  for (const [capID, raw] of Object.entries(v)) {
    if (!Array.isArray(raw)) {
      throw new ScenarioInvalidError(file, `toolSpecs.${capID}`, 'expected array');
    }
    out[capID] = raw.map((spec, i) => parseToolSpec(spec, file, `toolSpecs.${capID}[${i}]`));
  }
  return out;
}

function parseToolSpec(spec: unknown, file: string, field: string): ScenarioToolSpec {
  if (!isRecord(spec) || typeof spec['name'] !== 'string' || typeof spec['description'] !== 'string') {
    throw new ScenarioInvalidError(file, field, 'expected { name, description, input_schema }');
  }
  return {
    name: spec['name'],
    description: spec['description'],
    input_schema: spec['input_schema'] ?? {},
  };
}

function optionalScripted(
  rec: Record<string, unknown>, file: string,
): ScenarioScripted | undefined {
  const v = rec['scripted'];
  if (v === undefined) return undefined;
  if (!isRecord(v) || !Array.isArray(v['steps'])) {
    throw new ScenarioInvalidError(file, 'scripted', 'expected { steps: [...] }');
  }
  return { steps: v['steps'].map((step, i) => parseScriptedStep(step, file, `scripted.steps[${i}]`)) };
}

function parseScriptedStep(step: unknown, file: string, field: string): ScenarioScriptedStep {
  if (!isRecord(step)) {
    throw new ScenarioInvalidError(file, field, 'expected mapping');
  }
  const out: ScenarioScriptedStep = {
    text: typeof step['text'] === 'string' ? step['text'] : undefined,
    toolCalls: Array.isArray(step['toolCalls'])
      ? step['toolCalls'].map((tc, i) => parseScriptedToolCall(tc, file, `${field}.toolCalls[${i}]`))
      : undefined,
  };
  return out;
}

function parseScriptedToolCall(tc: unknown, file: string, field: string): ScenarioToolCall {
  if (!isRecord(tc) || typeof tc['id'] !== 'string' || typeof tc['name'] !== 'string') {
    throw new ScenarioInvalidError(file, field, 'expected { id, name, args }');
  }
  return { id: tc['id'], name: tc['name'], args: tc['args'] ?? {} };
}
