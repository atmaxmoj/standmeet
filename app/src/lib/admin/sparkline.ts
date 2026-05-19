// sparkline —— Sparkline 的算列宽 / 高占比。挪到 lib 才不踩 complexity ≤ 3。

export interface SparkColumn {
  heightPct: number;
  widthPx: number;
}

export function computeSparkColumns(data: readonly number[], width: number): SparkColumn[] {
  const max = Math.max(1, ...data);
  const w = data.length > 0 ? width / data.length : 0;
  return data.map((v) => ({
    heightPct: (v / max) * 100,
    widthPx: Math.max(1, w - 0.5),
  }));
}
