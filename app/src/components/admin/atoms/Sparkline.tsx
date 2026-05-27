// Sparkline —— SVG polyline 折线图。design 源 sm-components.js Sparkline。
// data = number[]，纯 SVG 渲，accent stroke + 半透 area fill。

import { deriveSparklinePoints } from '@/lib/admin/sparkline';

type Props = {
  data: readonly number[];
  width?: number;
  height?: number;
  label?: string;
};

export function Sparkline({ data, width = 260, height = 48, label }: Props) {
  const points = deriveSparklinePoints(data, width, height);
  return <SparklineSVG points={points} width={width} height={height} label={label} />;
}

function SparklineSVG({ points, width, height, label }: {
  points: string; width: number; height: number; label?: string;
}) {
  const area = `0,${height} ${points} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="none"
      aria-label={label ?? 'sparkline'}
      role="img"
      data-testid="sparkline"
    >
      <polygon
        points={area}
        fill="color-mix(in oklab, var(--color-accent) 12%, transparent)"
      />
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
