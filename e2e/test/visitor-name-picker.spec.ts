// visitor-name-picker.spec.ts -- scanning a code (pending code) -> pops the
// VisitorNamePicker modal; defer-issue: the modal itself is the issue point, a session only
// opens once the name is filled in or skipped.
//
// Business story:
//   1. Enter / via a QR scan -> the modal auto-pops (access granted · code...).
//   2. Visitor fills in a name + submits -> session opens + modal disappears + SessionStrip shows the name.
//   3. Skip -> session opens anonymously, modal disappears; on reload (pending consumed + session exists) it does not pop again.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'name-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'nameowner',
  fullName: 'Name Owner',
};

const CODE = 'NAME-001';

test.describe('VisitorNamePicker · auto-pop on first chat + persist', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithCode(playwright);
  });

  test('QR absorb → modal pops; submit name → session + strip shows name',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      // The modal auto-pops (there's a pending code).
      const nameInput = page.getByTestId('visitor-name-input');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      // Type + submit -> session opens + modal disappears + strip shows the name.
      await nameInput.fill('Recruiter Joe');
      await page.getByTestId('visitor-name-submit').click();
      await expect(nameInput).toBeHidden({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Recruiter Joe', {
        timeout: 10_000,
      });
    });

  test('skip → anonymous session, modal closes; reload does not re-pop',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      const skipBtn = page.getByTestId('visitor-name-skip');
      await expect(skipBtn).toBeVisible({ timeout: 5_000 });
      await skipBtn.click();
      // Modal disappears + an anonymous session starts (strip appears).
      await expect(skipBtn).toBeHidden({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 10_000 });
      // Reload: pending consumed + session persisted to LS -> modal does not pop again.
      await goto(page, '/');
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('visitor-name-skip')).toBeHidden();
    });

  // F-A-5 — re-opening the SAME ?code= link while already in a named session must
  // NOT re-pop the identity picker over the active session.
  test('re-entry with the same code does not re-pop the picker over an active session',
    async ({ page }) => {
      // Establish a named session for CODE.
      await goto(page, `/?code=${CODE}`);
      const nameInput = page.getByTestId('visitor-name-input');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await nameInput.fill('Recruiter Joe');
      await page.getByTestId('visitor-name-submit').click();
      await expect(nameInput).toBeHidden({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Recruiter Joe', {
        timeout: 10_000,
      });
      // Recruiter re-scans / re-opens the same code link — already resolved.
      await goto(page, `/?code=${CODE}`);
      // Strip still shows the same identity; the picker does NOT re-appear.
      await expect(page.getByTestId('session-strip')).toContainText('Recruiter Joe', {
        timeout: 10_000,
      });
      await expect(page.getByTestId('visitor-name-overlay')).toBeHidden();
    });
});

async function initOwnerWithCode(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await seedCode(request);
  await request.dispose();
}

async function seedCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'name-seed-token');
  await initMCP(request, apiToken);
  await createCode(request, csrf, {
    code: CODE,
    label: 'Visitor name picker test',
  });
}
