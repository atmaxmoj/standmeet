// QRCode —— React port of the design's hand-rolled QR component
// (docs/design/project/sm-components.js:259). Three finder-pattern
// squares get the vermillion accent; remaining dark modules are ink.
// Brand-visible at scanner distance without tanking scanner contrast
// (Reed-Solomon recovery handles the color split).

import { useTranslations } from 'next-intl';

import {
  buildQRGrid, type QRCell, type QRGrid,
} from '@/lib/admin/qr-modules';

import styles from '@/components/admin/resume-page/QRCode.module.css';

export interface QRCodeProps {
  value: string;
  size?: number;
  /** Quiet-zone modules around the grid; design default 2. */
  quiet?: number;
}

// 0.4-px cell oversize matches the design — closes hairline gaps Chrome
// occasionally renders between adjacent rects at fractional zoom.
const CELL_BLEED = 0.4;

export function QRCode(props: QRCodeProps) {
  const opts = withDefaults(props);
  const grid = buildQRGrid(opts.value);
  return grid
    ? <QRSvg grid={grid} size={opts.size} quiet={opts.quiet} />
    : <QRFallback size={opts.size} />;
}

function withDefaults(p: QRCodeProps): { value: string; size: number; quiet: number } {
  return { value: p.value, size: p.size ?? 96, quiet: p.quiet ?? 2 };
}

function QRSvg({ grid, size, quiet }: { grid: QRGrid; size: number; quiet: number }) {
  const total = grid.n + quiet * 2;
  const cell = size / total;
  const offset = quiet * cell;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={styles.svg}
    >
      <rect width={size} height={size} className={styles.bg} />
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
      className={cd.finder ? styles.finder : styles.module}
    />
  );
}

function QRFallback({ size }: { size: number }) {
  const t = useTranslations('adminJobs');
  return (
    <div
      className={styles.fallback}
      // eslint-disable-next-line no-restricted-syntax -- size is a prop, runtime-dynamic
      style={{ width: size, height: size }}
    >
      {t('qr.fallback')}
    </div>
  );
}
