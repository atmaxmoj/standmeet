// p1-variant-drive.mjs —— drive the REAL prod GUI (real DeepSeek) through one broad-question
// visitor turn and screenshot the four moments that differentiate the F-A-4 P1 presentation
// variants: narration streaming / tools running / answer landed / after reload.
//
//   VARIANT=<name> node p1-variant-drive.mjs
//
// Shots land in /tmp/p1-variants/<name>-{t06,t15,t30,done,reload}.png plus a JSON summary
// (answer-area text at each moment) for the comparison table.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:38227';
const CODE = process.env.CODE ?? 'FA5-001';
const VARIANT = process.env.VARIANT ?? 'unnamed';
const OUT = `/tmp/p1-variants`;
const QUESTION = process.env.QUESTION ??
  'What recurring themes run across your whole corpus — math, cybernetics, projects? ' +
  'Survey everything and pull the threads together.';

mkdirSync(OUT, { recursive: true });

const summary = { variant: VARIANT, moments: {} };

async function answerAreaText(page) {
  return page.evaluate(() => {
    const bodies = [...document.querySelectorAll('[data-testid="answer-body"]')];
    const last = bodies[bodies.length - 1];
    const throb = document.querySelector('[data-testid="tool-throbbers"]');
    const note = document.querySelector('[data-testid="process-note"]');
    return {
      answer: last ? last.innerText.slice(0, 400) : '',
      answer_len: last ? last.innerText.length : 0,
      throbber: throb ? throb.innerText.slice(0, 200) : '',
      process_note: note ? note.innerText.slice(0, 200) : '',
    };
  });
}

async function moment(page, tag) {
  await page.screenshot({ path: `${OUT}/${VARIANT}-${tag}.png` });
  summary.moments[tag] = await answerAreaText(page);
  console.log(`[${VARIANT}/${tag}]`, JSON.stringify(summary.moments[tag]));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// Enter as a visitor on the code link; handle the name picker if it pops.
await page.goto(`${BASE}/?code=${CODE}`);
const nameInput = page.getByTestId('visitor-name-input');
if (await nameInput.isVisible({ timeout: 4000 }).catch(() => false)) {
  await nameInput.fill(`P1 ${VARIANT} ${Date.now() % 100000}`); // fresh member per run — no history bleed
  await page.getByTestId('visitor-name-submit').click();
}
await page.getByTestId('session-strip').waitFor({ timeout: 15000 });

// Ask the broad question.
const input = page.locator('[data-testid="chat-input-field"]');
await input.fill(QUESTION);
await input.press('Enter');

// Mid-stream moments.
for (const [tag, ms] of [['t06', 6000], ['t15', 9000], ['t30', 15000]]) {
  await page.waitForTimeout(ms);
  await moment(page, tag);
}

// Wait for the turn to land: the ask input is disabled while pending and re-enables on
// finalize — the only reliable GUI-level done signal (the throbber is empty between rounds).
await page.waitForFunction(() => {
  const i = document.querySelector('[data-testid="chat-input-field"]');
  return i && !i.disabled;
}, undefined, { timeout: 300000 });
await moment(page, 'done');

// Reload — the durable transcript (backend product-only after 122e922).
await page.reload();
await page.waitForTimeout(4000);
await moment(page, 'reload');

writeFileSync(`${OUT}/${VARIANT}.json`, JSON.stringify(summary, null, 2));
await browser.close();
console.log(`[${VARIANT}] done → ${OUT}/${VARIANT}.json`);
