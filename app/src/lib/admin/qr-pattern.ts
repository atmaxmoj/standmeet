// qr-pattern —— deterministic faux-QR cell grid (no real QR encoding).
// design uses a 25×25 module tile w/ 3 finder squares; we hash the value
// to fill module pixels so different codes look different.

export interface QRCell {
  x: number;
  y: number;
  s: number;
  finder: boolean;
}

const MODULES = 25;

export function buildQRCells(value: string, size: number): QRCell[] {
  const cell = size / MODULES;
  const seed = hashString(value || ' ');
  const cells: QRCell[] = [];
  for (let r = 0; r < MODULES; r++) {
    for (let c = 0; c < MODULES; c++) {
      const fin = isFinder(r, c);
      const on = fin ? isFinderPixel(r, c) : pseudoBit(seed, r, c);
      on && cells.push({ x: c * cell, y: r * cell, s: cell + 0.4, finder: fin });
    }
  }
  return cells;
}

function isFinder(r: number, c: number): boolean {
  return (r < 7 && c < 7) || (r < 7 && c >= MODULES - 7) || (r >= MODULES - 7 && c < 7);
}

// 7×7 finder square: outer ring + inner 3×3 block.
function isFinderPixel(r: number, c: number): boolean {
  const rr = r < 7 ? r : MODULES - 1 - r;
  const cc = c < 7 ? c : MODULES - 1 - c;
  const outer = rr === 0 || rr === 6 || cc === 0 || cc === 6;
  const inner = rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4;
  return outer || inner;
}

function pseudoBit(seed: number, r: number, c: number): boolean {
  const v = (seed * 0x9E3779B1) ^ ((r + 1) * 0x85EBCA77) ^ ((c + 1) * 0xC2B2AE3D);
  return ((v ^ (v >>> 13)) & 0x3) === 0;
}

function hashString(s: string): number {
  let h = 0x811C9DC5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}
