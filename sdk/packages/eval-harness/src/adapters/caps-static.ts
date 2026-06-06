// caps-static.ts —— CapabilityStateSource adapter: scenario YAML 里写死
// 的常量。runner 把 Scenario.capabilities map 转成 CapabilityState[]，
// agent loop 每轮调 current() 拿到同一份。
//
// onChange 不实现 —— eval 跑期间不模拟 capability re-issue。

import type {
  CapabilityState,
  CapabilityStateSource,
} from '@standmeet/agent-core';

import type { Scenario } from '../scenario.js';

export function staticCapabilityStateSource(
  scenario: Scenario,
): CapabilityStateSource {
  const states: CapabilityState[] = Object.entries(scenario.capabilities).map(
    ([id, raw]) => ({
      id,
      enabled: raw.enabled,
      // Scenario yaml 里 capability 可能带 corpus_uris / quotas 等额外字段；
      // 一并透传到 CapabilityState 让 prompt 模板拼出来。
      ...filterCapExtras(raw),
    }),
  );
  return {
    current(): readonly CapabilityState[] {
      return states;
    },
  };
}

function filterCapExtras(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'enabled') out[k] = v;
  }
  return out;
}
