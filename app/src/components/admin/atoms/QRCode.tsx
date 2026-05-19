// QRCode —— 仅用于设计预览的伪 QR。生成确定性 modulation pattern，
// 加入 3 个 finder 角块。pixel-exact 的 QR 不在此范围内（线上发 share-URL
// 时还是用真 QR 库；这里只展示 design-style block tile）。

import { buildQRCells, type QRCell } from '@/lib/admin/qr-pattern';

type Props = {
  value: string;
  size?: number;
};

export function QRCode({ value, size = 96 }: Props) {
  const cells = buildQRCells(value, size);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="block"
    >
      <rect width={size} height={size} fill="var(--color-paper)" />
      {cells.map((c, i) => <QRRect key={i} cell={c} />)}
    </svg>
  );
}

function QRRect({ cell }: { cell: QRCell }) {
  const fill = cell.finder ? 'var(--color-accent)' : 'var(--color-ink)';
  return <rect x={cell.x} y={cell.y} width={cell.s} height={cell.s} fill={fill} />;
}
