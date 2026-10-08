// Render a PDF page to pixels, so a spec can assert on rendered appearance that the text-only
// pdf-parse can't see (e.g. a background filling the page). pdf-to-img rasterizes to PNG, pngjs
// decodes to RGBA. pdf-to-img is ESM-only, hence the dynamic import() below.

import jsQR from 'jsqr';
import { PNG } from 'pngjs';

export interface RasterPage {
  width: number;
  height: number;
  rgba(x: number, y: number): { r: number; g: number; b: number; a: number };
}

async function pagePNG(buf: Buffer, pageNum: number, scale: number): Promise<PNG> {
  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(buf, { scale });
  let idx = 0;
  let target: Buffer | undefined;
  for await (const image of doc) {
    idx += 1;
    if (idx === pageNum) { target = image; break; }
  }
  if (target === undefined) throw new Error(`PDF has no page ${pageNum} (rendered ${idx})`);
  return PNG.sync.read(target);
}

// decodeQROnPage —— what a phone camera reads off the printed page: the page is rasterized and the
// QR decoded from the pixels, so the assertion sees the drawn code, not the URL the server meant.
// Scale 4: the résumé's QR is ~46 px wide on the page; smaller rasters lose its modules.
export async function decodeQROnPage(buf: Buffer, pageNum = 1, scale = 4): Promise<string> {
  const png = await pagePNG(buf, pageNum, scale);
  const found = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (found === null) throw new Error(`no readable QR code on page ${pageNum}`);
  return found.data;
}

// Decode page `pageNum` (1-based) of `buf` to an RGBA raster at `scale`.
export async function rasterizePDFPage(
  buf: Buffer, pageNum: number, scale = 2,
): Promise<RasterPage> {
  const png = await pagePNG(buf, pageNum, scale);
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
