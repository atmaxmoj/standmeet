// landing-mobile.mjs —— the standmeet.com landing at phone width, measured rather than eyeballed:
// horizontal overflow (and which elements cause it), tap targets under 32px tall, text under 11px,
// and which navigation links are visible. Read-only; saves a first-screen and a full-page shot per
// page. Usage (through the Makefile): make landing-mobile [BASE=https://standmeet.com] OUT=<dir>

import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const BASE = process.env.LANDING_BASE ?? 'https://standmeet.com';
const OUT = process.env.LANDING_OUT;
const PAGES = ['/en/', '/zh/', '/en/use-cases/', '/en/self-host/', '/en/faq/', '/en/blog/', '/zh/blog/'];

if (!OUT) {
  console.error('usage: make landing-mobile OUT=<dir> [BASE=<origin>]');
  process.exit(2);
}
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const report = [];
for (const p of PAGES) {
  await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 45_000 })
    .catch((e) => console.log(`goto ${p}: ${e.message}`));
  report.push({ p, ...await page.evaluate(measure) });
  const name = p.replace(/\//g, '_');
  await page.screenshot({ path: `${OUT}/${name}top.png` });
  await page.screenshot({ path: `${OUT}/${name}full.png`, fullPage: true });
}
await browser.close();
console.log(JSON.stringify(report, null, 1));

function measure() {
  const vw = document.documentElement.clientWidth;
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = (e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`;
  const overflow = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect();
    return shown(e) && (r.right > vw + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed';
  }).filter((e) => e.getBoundingClientRect().right > -100) // skip off-screen skip-links / sr-only
    .map((e) => `${label(e)} in ${String(e.closest('section')?.className ?? '-').split(' ')[0]}`
      + ` L${Math.round(e.getBoundingClientRect().left)} R${Math.round(e.getBoundingClientRect().right)}`
      + ` clip:${getComputedStyle(e.parentElement).overflowX}`);
  const smallTaps = [...document.querySelectorAll('a,button,summary')].filter((e) =>
    shown(e) && e.getBoundingClientRect().height < 32)
    .map((e) => `${e.textContent.trim().slice(0, 24)}(${Math.round(e.getBoundingClientRect().height)})`);
  const tinyText = [...document.querySelectorAll('body *')].filter((e) => shown(e)
    && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    && parseFloat(getComputedStyle(e).fontSize) < 11)
    .map((e) => `${e.textContent.trim().slice(0, 20)}(${getComputedStyle(e).fontSize})`);
  const nav = [...document.querySelectorAll('nav a, header a, nav button, header button')]
    .filter(shown).map((a) => a.textContent.trim());
  return {
    scrollW: document.documentElement.scrollWidth, vw, height: document.documentElement.scrollHeight,
    overflowCount: overflow.length, overflow: overflow.slice(0, 40),
    smallTapCount: smallTaps.length, smallTaps: smallTaps.slice(0, 8),
    tinyTextCount: tinyText.length, tinyText: tinyText.slice(0, 8), nav,
  };
}
