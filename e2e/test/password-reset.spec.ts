// password-reset.spec.ts — end-to-end coverage for the emergency password reset fallback.
//
// User story:
//   The owner forgot their password. They ssh into the server, run `docker exec` on the
//   `standmeet password-reset` subcommand, and stdout prints an /account/reset?t=... link.
//   The owner copies the link into a browser, fills in the new password twice -> submit
//   -> redirected to /login -> logs in successfully with the new password. The token gets
//   consumed; a second attempt at the same URL fails.
//
// e2e implementation: does not go through the real Makefile (`make password-reset` calls
// `docker compose exec`, while the e2e fixture convention is `docker exec` directly
// against the container); a fixture helper calls
// `docker exec standmeet-dev-backend-1 /standmeet password-reset` and reads the URL out
// of stdout.

import { execSync } from 'node:child_process';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const NEW_PASSWORD = 'brand-new-correct-horse-12345';

test.describe('owner uses CLI-issued reset link to set a new password', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('CLI prints /account/reset?t=...; form sets new password; old one stops working',
    async ({ page, playwright }) => {
      const url = issueResetToken();
      await openResetAndSubmit(page, url, NEW_PASSWORD);

      // New password logs in OK; old password gets 401.
      const request = await playwright.request.newContext();
      const fresh = await loginAPI(request, OWNER.email, NEW_PASSWORD);
      expect(fresh.csrf).toBeTruthy();
      await expectLoginRejected(request, OWNER.email, OWNER.password);
      await request.dispose();
    });

  test('reset URL is single-use; second submission with same token fails',
    async ({ page }) => {
      const url = issueResetToken();
      // First submission succeeds (change the password once first)
      await openResetAndSubmit(page, url, NEW_PASSWORD + '-1');
      // Second submission at the same URL should get 401 and stay on the form
      await goto(page, urlPath(url));
      await page.getByTestId('reset-new-password').fill(NEW_PASSWORD + '-2');
      await page.getByTestId('reset-confirm-password').fill(NEW_PASSWORD + '-2');
      await page.getByTestId('reset-submit').click();
      await expect(page.getByTestId('reset-error')).toBeVisible();
      await expect(page.getByTestId('reset-error')).toContainText(/invalid|expired/i);
    });
});

// issueResetToken — docker exec runs standmeet password-reset; grabs the reset URL from
// stdout. The subcommand exits once it's done; execSync captures the full output.
function issueResetToken(): string {
  const out = execSync(
    'docker compose -f ../docker-compose.dev.yml -p standmeet-dev '
    + 'exec -T backend /app/standmeet password-reset',
    { encoding: 'utf-8' },
  );
  const match = out.match(/(https?:\/\/[^\s]+\/account\/reset\?t=[^\s]+)/);
  if (!match || !match[1]) {
    throw new Error('did not find reset URL in CLI output:\n' + out);
  }
  return match[1];
}

function urlPath(absURL: string): string {
  const u = new URL(absURL);
  return u.pathname + u.search;
}

async function openResetAndSubmit(page: Page, url: string, newPwd: string): Promise<void> {
  await goto(page, urlPath(url));
  await expect(page.getByRole('heading', { name: /Set a new/i })).toBeVisible();
  await page.getByTestId('reset-new-password').fill(newPwd);
  await page.getByTestId('reset-confirm-password').fill(newPwd);
  await page.getByTestId('reset-submit').click();
  await page.waitForURL('**/login', { timeout: 10_000 });
}

async function expectLoginRejected(
  request: APIRequestContext, email: string, password: string,
): Promise<void> {
  const res = await request.post(
    (process.env['BACKEND_URL'] ?? 'http://localhost:8000') + '/api/admin/login',
    { data: { email, password } },
  );
  expect(res.status()).toBe(401);
}
