// Sparkline —— SVG polyline chart + real axis + real hover tooltip (F-C-5, second pass).
//
// The first version only had a peak number + a native SVG <title>; the owner sent it
// back: "no axis, no hover tooltip showing the actual number" — a <title> needs
// hovering over the stretched 1.6px dot for ~1s, which is effectively unusable. Now:
//   - Axis: baseline + midline + peakline, three grid lines (SVG), plus 0 / mid / max
//     tick values (HTML overlay — the svg is stretched by preserveAspectRatio="none",
//     so text inside it would distort; ticks use absolutely-positioned HTML instead).
//   - Tooltip: onMouseMove over the whole chart snaps to the nearest point
//     (nearestSparkIndex), rendering a crosshair + highlighted dot (SVG) plus a value
//     box "date · value" above the cursor (HTML). Disappears on mouse leave.

'use client';

import { useRef, useState } from 'react';

import type { SparkPoint } from '@/lib/admin/sparkline';
import {
  nearestSparkIndex, sparkHoverPt, sparklinePoints, sparkTip,
} from '@/lib/admin/sparkline';

const PAD = 2; // matches sparklinePoints' pad: max → y=PAD, 0 → y=h-PAD

type Props = {
  data: readonly number[];
  labels?: readonly string[];   // per-point x label (date); aligned to data, tooltip shows value-only if omitted
  width?: number;
  height?: number;
  label?: string;
};

export function Sparkline({ data, labels, width = 260, height = 48, label }: Props) {
  const pts = sparklinePoints(data, width, height);
  const { boxRef, hover, onMove, clear } = useSparkHover(data.length);
  return (
    <div
      ref={boxRef}
      className="relative"
      onMouseMove={onMove}
      onMouseLeave={clear}
      data-testid="sparkline-box"
    >
      <ChartSVG pts={pts} width={width} height={height} label={label} hover={hover} />
      <AxisLabels max={Math.max(...data, 1)} />
      <TipSlot pts={pts} labels={labels} hover={hover} width={width} />
    </div>
  );
}

// useSparkHover —— whole-chart hover snap: mousemove → nearest point index; leave clears it.
function useSparkHover(n: number) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => setHoverFromEvent(e, boxRef.current, n, setHover);
  const clear = () => setHover(null);
  return { boxRef, hover, onMove, clear };
}

function setHoverFromEvent(
  e: React.MouseEvent, el: HTMLDivElement | null, n: number, set: (i: number) => void,
): void {
  const r = el?.getBoundingClientRect();
  r && set(nearestSparkIndex((e.clientX - r.left) / r.width, n));
}

// TipSlot —— renders the value box on hover hit; renders null (empty slot) otherwise.
function TipSlot({ pts, labels, hover, width }: {
  pts: readonly SparkPoint[]; labels?: readonly string[]; hover: number | null; width: number;
}) {
  const tip = sparkTip(pts, labels, hover, width);
  return tip ? <HoverTip fracX={tip.fracX01} text={tip.text} /> : null;
}

function ChartSVG({ pts, width, height, label, hover }: {
  pts: readonly SparkPoint[]; width: number; height: number; label?: string;
  hover: number | null;
}) {
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const hoverPt = sparkHoverPt(pts, hover);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full overflow-visible"
      preserveAspectRatio="none"
      aria-label={label ?? 'sparkline'}
      role="img"
      data-testid="sparkline"
    >
      <AxisGrid width={width} height={height} />
      <polygon
        points={`0,${height - PAD} ${line} ${width},${height - PAD}`}
        fill="color-mix(in oklab, var(--color-accent) 12%, transparent)"
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={1.6} fill="var(--color-accent)" />)}
      {hoverPt ? <HoverMark pt={hoverPt} height={height} /> : null}
    </svg>
  );
}

// AxisGrid —— three reference lines: peakline (y=PAD), midline, baseline (y=h-PAD),
// plus a y-axis at the left edge. Tick values live in AxisLabels (HTML).
function AxisGrid({ width, height }: { width: number; height: number }) {
  const mid = PAD + (height - PAD * 2) / 2;
  return (
    <g stroke="var(--color-rule)" strokeWidth="0.6">
      <line x1="0" y1={PAD} x2={width} y2={PAD} strokeDasharray="2 3" />
      <line x1="0" y1={mid} x2={width} y2={mid} strokeDasharray="2 3" />
      <line x1="0" y1={height - PAD} x2={width} y2={height - PAD} />
      <line x1="0" y1={PAD} x2="0" y2={height - PAD} />
    </g>
  );
}

// HoverMark —— crosshair + highlight ring for the snapped point (SVG side).
function HoverMark({ pt, height }: { pt: SparkPoint; height: number }) {
  return (
    <g data-testid="sparkline-hover-mark">
      <line
        x1={pt.x} y1={PAD} x2={pt.x} y2={height - PAD}
        stroke="var(--color-faint)" strokeWidth="0.6" strokeDasharray="2 2"
      />
      <circle cx={pt.x} cy={pt.y} r={3} fill="none" stroke="var(--color-ink)" strokeWidth="1" />
    </g>
  );
}

// AxisLabels —— y-axis ticks (max / mid / 0), HTML absolutely positioned against the
// left edge (kept out of the stretched svg so the text doesn't distort).
//
// The middle tick is **omitted when it can't be drawn cleanly**: when `max` is small,
// `round(max/2)` collides with the other two ticks — at `max=1` the three ticks would
// read `1 … 1 … 0`, the same value shown twice, right when the corpus is just starting
// and the chart most needs to be legible (UX-42). A duplicated tick is worse than a
// missing one: it makes the reader think they misread it.
function midTick(max: number): number | null {
  const mid = Math.round(max / 2);
  return mid > 0 && mid < max ? mid : null;
}

function AxisLabels({ max }: { max: number }) {
  const mid = midTick(max);
  return (
    <div
      className="pointer-events-none absolute inset-0 mono text-[8px] leading-none text-(--color-faint)"
      data-testid="sparkline-axis"
    >
      <span className="absolute left-0.5 top-0 -translate-y-1/2 bg-(--color-paper)/80 px-0.5">{max}</span>
      {mid !== null && (
        <span className="absolute left-0.5 top-1/2 -translate-y-1/2 bg-(--color-paper)/80 px-0.5">{mid}</span>
      )}
      <span className="absolute left-0.5 bottom-0 translate-y-1/2 bg-(--color-paper)/80 px-0.5">{0}</span>
    </div>
  );
}

// HoverTip —— value box "date · value" directly above the snapped point.
// Position tracks the point (runtime-dynamic → inline style).
function HoverTip({ fracX, text }: { fracX: number; text: string }) {
  const leftPct = `${Math.min(92, Math.max(8, fracX * 100))}%`;
  return (
    <div
      className="pointer-events-none absolute -top-1 -translate-x-1/2 -translate-y-full whitespace-nowrap border border-(--color-rule) bg-(--color-paper) px-1.5 py-0.5 mono text-[10px] text-(--color-ink) shadow-sm"
      // eslint-disable-next-line no-restricted-syntax -- left tracks the hovered point at runtime
      style={{ left: leftPct }}
      data-testid="sparkline-tooltip"
    >
      {text}
    </div>
  );
}
