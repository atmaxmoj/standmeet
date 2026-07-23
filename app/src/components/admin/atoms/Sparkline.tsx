// Sparkline —— SVG polyline 折线图 + 真轴 + 真 hover tooltip(F-C-5 二次返工)。
//
// 第一版只放了峰值数字 + 原生 SVG <title>,owner 打回:「没有轴,没有 hover tooltip 显示具体数字」——
// <title> 要悬停在被拉伸的 1.6px 圆点上等 ~1s,等于没有。现在:
//   - 轴:基线 + 中线 + 峰线三条网格线(SVG),0 / mid / max 三个刻度值(HTML 覆盖层 —— svg 被
//     preserveAspectRatio="none" 拉伸,文字放里面会变形,所以刻度用绝对定位 HTML)。
//   - tooltip:整图 onMouseMove 吸附最近点(nearestSparkIndex),渲染十字线 + 高亮点(SVG)+
//     鼠标上方的数值框「日期 · 值」(HTML)。离开即消失。

'use client';

import { useRef, useState } from 'react';

import type { SparkPoint } from '@/lib/admin/sparkline';
import {
  nearestSparkIndex, sparkHoverPt, sparklinePoints, sparkTip,
} from '@/lib/admin/sparkline';

const PAD = 2; // 与 sparklinePoints 的 pad 对齐:max → y=PAD,0 → y=h-PAD

type Props = {
  data: readonly number[];
  labels?: readonly string[];   // 每点的 x 标签(日期);对齐 data,缺省则 tooltip 只显值
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

// useSparkHover —— 整图 hover 吸附:mousemove → 最近点下标;离开清空。
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

// TipSlot —— hover 命中时渲染数值框;未命中渲染 null(空槽)。
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

// AxisGrid —— 三条参考线:峰线(y=PAD)、中线、基线(y=h-PAD),加左缘 y 轴。刻度值在 AxisLabels(HTML)。
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

// HoverMark —— 吸附点的十字线 + 高亮环(SVG 侧)。
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

// AxisLabels —— y 轴刻度(max / mid / 0),HTML 绝对定位贴左缘(不进被拉伸的 svg,字不变形)。
function AxisLabels({ max }: { max: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 mono text-[8px] leading-none text-(--color-faint)"
      data-testid="sparkline-axis"
    >
      <span className="absolute left-0.5 top-0 -translate-y-1/2 bg-(--color-paper)/80 px-0.5">{max}</span>
      <span className="absolute left-0.5 top-1/2 -translate-y-1/2 bg-(--color-paper)/80 px-0.5">{Math.round(max / 2)}</span>
      <span className="absolute left-0.5 bottom-0 translate-y-1/2 bg-(--color-paper)/80 px-0.5">{0}</span>
    </div>
  );
}

// HoverTip —— 吸附点正上方的数值框「日期 · 值」。位置随点动(runtime-dynamic → inline style)。
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
