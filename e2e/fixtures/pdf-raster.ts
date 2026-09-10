// Render a PDF page to pixels, so a spec can assert on rendered appearance that the text-only
// pdf-parse can't see (e.g. a background filling the page). pdf-to-img rasterizes to PNG, pngjs
// decodes to RGBA. pdf-to-img is ESM-only, hence the dynamic import() below.

import { PNG } from 'pngjs';

export interface RasterPage {
  width: number;
  height: number;
  rgba(x: number, y: number): { r: number; g: number; b: number; a: number };
}

// Decode page `pageNum` (1-based) of `buf` to an RGBA raster at `scale`.
export async function rasterizePDFPage(
  buf: Buffer, pageNum: number, scale = 2,
): Promise<RasterPage> {
  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(buf, { scale });
  let idx = 0;
  let target: Buffer | undefined;
  for await (const image of doc) {
    idx += 1;
    if (idx === pageNum) { target = image; break; }
  }
  if (target === undefined) throw new Error(`PDF has no page ${pageNum} (rendered ${idx})`);
  const png = PNG.sync.read(target);
  return {
    width: png.width,
    height: png.height,
    rgba(x, y) {
      const i = (png.width * Math.floor(y) + Math.floor(x)) * 4;
      return { r: png.data[i] ?? 0, g: png.data[i + 1] ?? 0, b: png.data[i + 2] ?? 0, a: png.data[i + 3] ?? 0 };
    },
  };
}

// near —— channel-wise closeness, so a sampled pixel counts as a target colour despite anti-aliasing
// or the rasterizer's rounding.
export function near(
  px: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
  tol = 14,
): boolean {
  return Math.abs(px.r - target.r) <= tol
    && Math.abs(px.g - target.g) <= tol
    && Math.abs(px.b - target.b) <= tol;
}

// CREAM —— the résumé paper ground (#F3EFE6). WHITE —— gotenberg's default page ground, which is what
// showed through below a short page before the fix.
export const CREAM = { r: 0xF3, g: 0xEF, b: 0xE6 };
export const WHITE = { r: 0xFF, g: 0xFF, b: 0xFF };
