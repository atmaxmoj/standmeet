// sparkline —— SVG polyline 点算法。data → 每点 {x,y,v}(值越大 y 越小),再拼成 "x,y …" string。

export interface SparkPoint { x: number; y: number; v: number; }

// sparklinePoints —— 把 data 映射成 SVG 坐标点(含原值 v,给 marker 的 tooltip 用)。
export function sparklinePoints(data: readonly number[], w: number, h: number): SparkPoint[] {
  const max = Math.max(...data, 1);
  const pad = 2;
  return data.map((v, i) => ({
    x: data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w,
    y: pad + (1 - v / max) * (h - pad * 2),
    v,
  }));
}

// nearestSparkIndex —— hover 命中:横向比例 frac(0..1)→ 最近的数据点下标。F-C-5 真 tooltip 用
// (整图任意位置 hover 都吸附到最近点,不再要求命中 1.6px 的圆点)。
export function nearestSparkIndex(frac: number, n: number): number {
  if (n <= 1) return 0;
  const i = Math.round(Math.min(1, Math.max(0, frac)) * (n - 1));
  return i;
}

// sparkTipText —— tooltip 文案:"日期 · 值"(无日期只显值)。
export function sparkTipText(label: string | undefined, v: number): string {
  return label ? `${label} · ${v}` : String(v);
}

// sparkHoverPt —— hover 下标 → 命中的点(未命中/越界 → undefined)。组件守 complexity 用。
export function sparkHoverPt(
  pts: readonly SparkPoint[], hover: number | null,
): SparkPoint | undefined {
  return hover === null ? undefined : pts[hover];
}

// SparkTip / sparkTip —— tooltip 的完整视图模型(水平比例 + 文案);未命中 → null。
export interface SparkTip { fracX01: number; text: string; }
export function sparkTip(
  pts: readonly SparkPoint[], labels: readonly string[] | undefined,
  hover: number | null, width: number,
): SparkTip | null {
  const pt = sparkHoverPt(pts, hover);
  if (!pt || hover === null) return null;
  return { fracX01: pt.x / width, text: sparkTipText(labels?.[hover], pt.v) };
}
