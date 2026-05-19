// pulse —— SystemPulse 的 7 日总数 + delta 计算。

export interface PulseSnapshot {
  total7: number;
  prev7: number;
  delta: number;
}

export function computePulse(growth: readonly number[]): PulseSnapshot {
  const sum = (arr: readonly number[]) => arr.reduce((a, b) => a + b, 0);
  const last7 = growth.slice(-7);
  const prev7 = growth.slice(-14, -7);
  const total7 = sum(last7);
  const prev = sum(prev7);
  return { total7, prev7: prev, delta: total7 - prev };
}
