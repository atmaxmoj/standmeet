import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:38227/?code=FA5-001');
const ni = page.getByTestId('visitor-name-input');
if (await ni.isVisible({ timeout: 4000 }).catch(() => false)) {
  await ni.fill(`full ${Date.now()%100000}`); await page.getByTestId('visitor-name-submit').click();
}
await page.getByTestId('session-strip').waitFor({ timeout: 15000 });
const input = page.locator('[data-testid="chat-input-field"]');
await input.fill('What recurring themes run across your whole corpus — math, cybernetics, projects? Survey everything and pull the threads together.');
await input.press('Enter');
await page.waitForFunction(() => {
  const i = document.querySelector('[data-testid="chat-input-field"]');
  return i && !i.disabled;
}, undefined, { timeout: 300000 });
const out = await page.evaluate(() => {
  const bodies = [...document.querySelectorAll('[data-testid="answer-body"]')];
  const last = bodies[bodies.length - 1];
  const cites = document.querySelector('[data-testid="citations"] summary');
  return { answer: last ? last.innerText : '(none)', cites: cites ? cites.innerText : '' };
});
console.log('===ANSWER-START===');
console.log(out.answer);
console.log('===ANSWER-END===');
console.log('CITES:', out.cites);
await browser.close();
