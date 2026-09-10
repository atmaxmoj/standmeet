// pixel-compare.ts —— read pixels off a screenshot, for assertions that DOM text cannot make.
//
// For the résumé thumbnail: a name can sit in the DOM of a canvas that renders blank or wrong, so
// toContainText proves nothing. inkRatio answers the question that actually matters — "is anything
// drawn here at all" — by counting non-background pixels. A blank/framed card is ~0 ink; a rendered
// résumé is full of dark text.

import { PNG } from 'pngjs';

// inkRatio —— fraction of non-background pixels. Background is the résumé paper cream (#F3EFE6) or
// white; anything meaningfully darker than that ground is ink.
export function inkRatio(png: Buffer): number {
  const p = PNG.sync.read(png);
  let ink = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const r = p.data[i], g = p.data[i + 1], b = p.data[i + 2];
    if (r < 220 || g < 210 || b < 200) ink++;
  }
  return ink / (p.width * p.height);
}
