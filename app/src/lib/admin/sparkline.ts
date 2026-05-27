// sparkline —— SVG polyline points 算法。data → "x,y x,y …" string。

export function deriveSparklinePoints(data: readonly number[], w: number, h: number): string {
  const max = Math.max(...data, 1);
  const pad = 2;
  return data
    .map((v, i) => {
      const x = data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w;
      const y = pad + (1 - v / max) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
