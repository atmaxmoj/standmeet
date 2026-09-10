// pixel-compare.ts —— read pixels off a screenshot, for assertions that DOM text cannot make.
//
// For the résumé thumbnail: a name can sit in the DOM of a canvas that renders blank or wrong, so
// toContainText proves nothing. inkRatio answers the cheap question — "is anything drawn here at
// all" — and diffRatio answers the real one — "does THIS surface render the same picture as THAT
// one" — both of which DOM text is blind to.

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// inkRatio —— fraction of non-background pixels. Background is the résumé paper cream (#F3EFE6) or
// white; anything meaningfully darker than that ground is ink.
export function inkRatio(png: Buffer): number {
  const p = PNG.sync.read(png);
  let ink = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const r = p.data[i] ?? 255, g = p.data[i + 1] ?? 255, b = p.data[i + 2] ?? 255;
    if (r < 220 || g < 210 || b < 200) ink++;
  }
  return ink / (p.width * p.height);
}

// avgColor —— the mean RGB of a PNG. For the asset panel: upload a solid-colour image, fetch the URL
// the panel actually renders, and check the bytes it serves are THAT image (same colour) — a broken
// or wrong URL serves something else (or nothing), which this catches where naturalWidth alone can't.
export function avgColor(png: Buffer): { r: number; g: number; b: number } {
  const p = PNG.sync.read(png);
  let r = 0, g = 0, b = 0;
  const n = p.width * p.height;
  for (let i = 0; i < p.data.length; i += 4) {
    r += p.data[i] ?? 0; g += p.data[i + 1] ?? 0; b += p.data[i + 2] ?? 0;
  }
  return { r: r / n, g: g / n, b: b / n };
}

// solidPNG —— a size×size image of one colour, as real PNG bytes. A distinctive colour makes the
// served-bytes comparison meaningful (a 1×1 tells you little); real bytes because the backend checks
// the declared type against the signature.
export function solidPNG(r: number, g: number, b: number, size = 8): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

// diffRatio —— the fraction of pixels that differ between two PNGs after normalizing both to the
// SAME small canvas. Two renders of the same résumé at different scales (the full-size editor sheet
// vs the scaled-down listing thumbnail) come off chromium with the same layout but different pixel
// dimensions and sub-pixel anti-aliasing; a box-filter downscale to a common size averages the AA
// noise away, leaving structure — so a blank/dark-framed/diverged thumbnail reads as a high diff
// while a faithful miniature reads as a low one. Both surfaces are the same browser renderer, so
// this is a fair pixel comparison, not a cross-pipeline one (which would be genuinely flaky).
export function diffRatio(a: Buffer, b: Buffer, w = 100, h = 140): number {
  const ra = boxDownscale(PNG.sync.read(a), w, h);
  const rb = boxDownscale(PNG.sync.read(b), w, h);
  const out = new Uint8Array(w * h * 4);
  // threshold 0.2 / includeAA false — tolerate sub-pixel colour noise, count only real differences.
  const mismatch = pixelmatch(ra, rb, out, w, h, { threshold: 0.2, includeAA: false });
  return mismatch / (w * h);
}

// boxDownscale —— average every source pixel that maps into a target cell (a box filter), returning
// a packed RGBA Uint8Array of the target size. Averaging (not nearest-neighbour) is what makes the
// downscaled image stable against the anti-aliasing that differs between the two scales.
function boxDownscale(src: PNG, tw: number, th: number): Uint8Array {
  const { width: sw, height: sh, data } = src;
  const out = new Uint8Array(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * sh) / th), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * sh) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * sw) / tw), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * sw) / tw));
      let r = 0, g = 0, b = 0, al = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * sw + x) * 4;
          r += data[i] ?? 0; g += data[i + 1] ?? 0; b += data[i + 2] ?? 0; al += data[i + 3] ?? 0; n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = al / n;
    }
  }
  return out;
}
