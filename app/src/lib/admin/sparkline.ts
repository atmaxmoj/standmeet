// sparkline —— SVG polyline point math. data → each point {x,y,v} (larger value = smaller y), then joined into "x,y …" string.

export interface SparkPoint { x: number; y: number; v: number; }

// sparklinePoints —— maps data into SVG coordinate points (includes the raw value v, for the marker's tooltip).
export function sparklinePoints(data: readonly number[], w: number, h: number): SparkPoint[] {
  const max = Math.max(...data, 1);
  const pad = 2;
  return data.map((v, i) => ({
    x: data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w,
    y: pad + (1 - v / max) * (h - pad * 2),
    v,
  }));
}

// nearestSparkIndex —— hover hit test: horizontal fraction frac (0..1) →
// nearest data-point index. Used by the F-C-5 real tooltip (hovering anywhere
// on the chart now snaps to the nearest point, instead of requiring a hit on a 1.6px dot).
export function nearestSparkIndex(frac: number, n: number): number {
  if (n <= 1) return 0;
  const i = Math.round(Math.min(1, Math.max(0, frac)) * (n - 1));
  return i;
}

// sparkTipText —— tooltip copy: "date · value" (no date → shows the value only).
export function sparkTipText(label: string | undefined, v: number): string {
  return label ? `${label} · ${v}` : String(v);
}

// sparkHoverPt —— hover index → the hit point (no hit / out of bounds → undefined). Used to keep the component's complexity down.
export function sparkHoverPt(
  pts: readonly SparkPoint[], hover: number | null,
): SparkPoint | undefined {
  return hover === null ? undefined : pts[hover];
}

// SparkTip / sparkTip —— the tooltip's complete view model (horizontal fraction + copy); no hit → null.
export interface SparkTip { fracX01: number; text: string; }
export function sparkTip(
  pts: readonly SparkPoint[], labels: readonly string[] | undefined,
  hover: number | null, width: number,
): SparkTip | null {
  const pt = sparkHoverPt(pts, hover);
  if (!pt || hover === null) return null;
  return { fracX01: pt.x / width, text: sparkTipText(labels?.[hover], pt.v) };
}
