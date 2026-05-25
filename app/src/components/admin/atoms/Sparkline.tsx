// Sparkline —— 简易 svg-less column sparkline。input 是数列。

import { computeSparkColumns } from '@/lib/admin/sparkline';

type Props = {
  data: readonly number[];
  width?: number;
  height?: number;
  label?: string;
};

export function Sparkline({ data, width = 120, height = 28, label }: Props) {
  const cols = computeSparkColumns(data, width);
  return (
    <div
      className="flex items-end gap-px"
      // width/height 是 caller-driven px，未来可能跟数据量动态变；不便枚举成
      // class。
      // eslint-disable-next-line no-restricted-syntax
      style={{ width, height }}
      title={label}
    >
      {cols.map((c, i) => <SparkCol key={i} heightPct={c.heightPct} widthPx={c.widthPx} />)}
    </div>
  );
}

function SparkCol({ heightPct, widthPx }: { heightPct: number; widthPx: number }) {
  return (
    <div
      className="bg-(--color-ink) opacity-70 hover:opacity-100 hover:bg-(--color-accent) transition-colors"
      // 每根 bar 高度从 data 算出（连续 %），宽度从 width / 数据点数算（连
      // 续 px）—— 真 runtime-dynamic，必走 inline style。
      // eslint-disable-next-line no-restricted-syntax
      style={{ height: `${heightPct}%`, width: `${widthPx}px` }}
    />
  );
}
