// code-rotate-gate.spec.ts —— a rotated code, verified at the REAL /gate front door: the NEW string
// opens a session, the OLD (rotated-away) string is refused. code-rotation.spec proves this at the
// API (issueSession); the audit found the BROWSER front door — the thing a leaked-code holder or a
// recruiter actually uses — was never driven for the rotation case ([[test-covers-capability-not-face]]).

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode, rotateCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { openGate } from '@/fixtures/navigate';

const OWNER = {
  email: 'rotate-gate@example.com', password: 'correct-horse-battery-staple',
  handle: 'rotategate', fullName: 'Rotate Gate Owner',
};
const OLD = 'ROT-OLDLEAK';
const NEW = 'ROT-NEWSAFE';

test.describe('code rotation · verified at the real /gate front door', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const code = await createCode(request, csrf, { code: OLD, label: 'leaked' });
    await rotateCode(request, csrf, code.id, NEW); // the leak-recovery action
    await request.dispose();
  });

  test('the rotated-in string opens at /gate; the rotated-away string is refused there', async ({ page }) => {
    test.setTimeout(90_000);
    // NEW string works at the front door → the code is accepted and a live coded chat opens (the
    // visitor leaves /gate and lands in a usable chat).
    await openGate(page);
    await page.getByTestId('gate-code').fill(NEW);
    await page.getByTestId('gate-code-submit').click();
    await expect(page.getByTestId('chat-input-field'), 'the rotated-in code opens a usable chat')
      .toBeEnabled({ timeout: 15_000 });

    // OLD string (the leaked one, rotated away) is refused at the front door → the gate error shows.
    await openGate(page);
    await page.getByTestId('gate-code').fill(OLD);
    await page.getByTestId('gate-code-submit').click();
    await expect(page.getByTestId('code-panel').getByTestId('gate-error'),
      'the leaked, rotated-away code is refused at the front door').toBeVisible({ timeout: 15_000 });
  });
});
