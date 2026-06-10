// QRCode —— 真·可扫 QR(qrcode-generator,经 lib/admin/qr-modules)。code 卡 +
// CodeQRModal 用它生成 share-URL 的二维码,手机扫得开。三个 finder 角块上
// vermillion(Reed-Solomon 容错扛得住配色),其余 ink。编码失败 → 优雅占位。
//
// #30:之前这里是 qr-pattern 的伪 QR(确定性花纹,扫不出),已换真库。

import { buildQRGrid, type QRCell, type QRGrid } from '@/lib/admin/qr-modules';

type Props = {
  value: string;
  size?: number;
};

const QUIET = 2; // quiet-zone modules around the grid
const CELL_BLEED = 0.4; // close hairline gaps Chrome renders at fractional zoom

export function QRCode({ value, size = 96 }: Props) {
  const grid = buildQRGrid(value);
  return grid
    ? <QRSvg grid={grid} size={size} />
    : <QRFallback size={size} />;
}

function QRSvg({ grid, size }: { grid: QRGrid; size: number }) {
  const total = grid.n + QUIET * 2;
  const cell = size / total;
  const offset = QUIET * cell;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="block"
    >
      <rect width={size} height={size} fill="var(--color-paper)" />
      {grid.cells.map((cd) => (
        <QRRect key={`${cd.r}-${cd.c}`} cd={cd} cell={cell} offset={offset} />
      ))}
    </svg>
  );
}

function QRRect({ cd, cell, offset }: { cd: QRCell; cell: number; offset: number }) {
  return (
    <rect
      x={offset + cd.c * cell}
      y={offset + cd.r * cell}
      width={cell + CELL_BLEED}
      height={cell + CELL_BLEED}
      fill={cd.finder ? 'var(--color-accent)' : 'var(--color-ink)'}
    />
  );
}

function QRFallback({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      <rect width={size} height={size} fill="var(--color-surface)" />
    </svg>
  );
}
