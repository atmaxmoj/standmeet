// qr-modules.ts —— real QR module-grid math (qrcode-generator). Pure logic lives
// in lib, shared by atoms/QRCode + resume-page/QRCode (originally under
// resume-page, moved to lib so the atom doesn't depend back on the section).
// Mirrors docs/design/project/sm-components.js:259.

import qrcodeGen from 'qrcode-generator';

const FINDER_SIZE = 7; // three finder boxes are 7×7 modules

export interface QRGrid {
  n: number;
  cells: readonly QRCell[];
}

export interface QRCell {
  r: number;
  c: number;
  finder: boolean;
}

/**
 * Build the QR module grid for `value`. Returns `null` on encoder error
 * so the caller can render a graceful fallback instead of crashing.
 */
export function buildQRGrid(value: string): QRGrid | null {
  const grid = makeRawGrid(value);
  if (!grid) return null;
  return { n: grid.n, cells: collectCells(grid.dark, grid.n) };
}

interface RawGrid {
  n: number;
  dark: ReadonlyArray<ReadonlyArray<boolean>>;
}

function makeRawGrid(value: string): RawGrid | null {
  try {
    const q = qrcodeGen(0, 'M');
    q.addData(value || ' ');
    q.make();
    const n = q.getModuleCount();
    const dark = buildDarkMatrix(q, n);
    return { n, dark };
  } catch {
    return null;
  }
}

function buildDarkMatrix(
  q: ReturnType<typeof qrcodeGen>, n: number,
): boolean[][] {
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(q.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

function collectCells(
  dark: ReadonlyArray<ReadonlyArray<boolean>>, n: number,
): QRCell[] {
  const out: QRCell[] = [];
  for (let r = 0; r < n; r++) {
    appendRowCells(out, dark[r], r, n);
  }
  return out;
}

function appendRowCells(
  out: QRCell[],
  row: ReadonlyArray<boolean> | undefined,
  r: number,
  n: number,
) {
  if (!row) return;
  for (let c = 0; c < n; c++) {
    if (row[c]) out.push({ r, c, finder: isFinderCell(r, c, n) });
  }
}

function isFinderCell(r: number, c: number, n: number): boolean {
  return (
    inFinderBox(r, c, 0, 0)
    || inFinderBox(r, c, 0, n - FINDER_SIZE)
    || inFinderBox(r, c, n - FINDER_SIZE, 0)
  );
}

function inFinderBox(r: number, c: number, baseR: number, baseC: number): boolean {
  return (
    r >= baseR && r < baseR + FINDER_SIZE
    && c >= baseC && c < baseC + FINDER_SIZE
  );
}
