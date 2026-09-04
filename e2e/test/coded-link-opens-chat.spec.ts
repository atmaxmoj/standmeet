// coded-link-opens-chat.spec.ts —— can the link **the product itself sends out** get in through the browser's front door (F-M-1).
//
// driven out of a real environment: the owner approves a request in `/admin/requests` → the mail really lands in a real inbox →
// the link inside is `http://…?code=inv-ilbro6` → **opening it shows gate's empty code box**. The same code typed into gate by hand
// opens a session fine. The only difference is letter case.
//
// the two paths have two sets of rules for the same concept:
//   · the hand-typed path in `code-panel-logic.ts:10` —— `raw.toUpperCase()`, so the "case doesn't matter"
//     written on gate is true;
//   · the `?code=` path in `use-absorb-code.ts:33` —— **absorbed as-is, not normalized**.
// and on the minting side both kinds of code are lowercase: `access_approval.go:169` (`inv-xxxxxx`, used in the approval mail),
// `jobsuc/applications.go:193` (`app-xxxxxx`, used by the QR in the top-right of the resume PDF).
// **the product mints lowercase, builds the link carrying lowercase as-is, and the front door only accepts uppercase.**
//
// why the existing guards are all green: `code-intro-greeting.spec.ts:52` drives `?code=` but its fixture is canonical uppercase;
// `applications-commit-qr-works.spec.ts`'s comment says it proves "QR can open chat", but it actually POSTs directly to
// `/api/v1/sessions` —— the backend accepts lowercase, and that **browser front door** was never driven
// ([[test-covers-capability-not-face]]).
//
// so what this pins is **the face**: a visitor takes the product's own link and opens it in a browser.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'codedlink@example.com', password: 'correct-horse-battery-staple',
  handle: 'codedlink', fullName: 'Coded Link Owner',
};

// lowercase —— **the shape the product itself mints** (both inv- and app- kinds). Not an edge-case input invented here.
const MINTED_LOWERCASE = 'inv-ab3d9f';

test.describe('产品发出去的那个链接，前门认不认', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'codedlink-invited', description: 'scoped', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, {
      code: MINTED_LOWERCASE, label: 'invite', assumed_role_id: role.id,
    });
    await request.dispose();
  });

  test('带着小写码的链接（批准信 / 简历 QR 的形状）直接开身份选择器，不掉回 gate',
    async ({ page }) => {
      await goto(page, `/?code=${MINTED_LOWERCASE}`);
      // the identity picker = this path went through. If it fell back to gate this testid wouldn't exist at all.
      await expect(
        page.getByTestId('visitor-name-overlay'),
        '拿着产品自己发的链接进来的人，不该再被要求输入一个他手上就有的码',
      ).toBeVisible({ timeout: 8_000 });
    });

  test('大写的同一张码照旧工作（修法不许把原来能用的那半弄坏）',
    async ({ page }) => {
      await goto(page, `/?code=${MINTED_LOWERCASE.toUpperCase()}`);
      await expect(page.getByTestId('visitor-name-overlay')).toBeVisible({ timeout: 8_000 });
    });
});
