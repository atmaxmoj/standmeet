// visitor-name-picker-zh.spec.ts -- F-I-2. The identity modal a code-holder meets first speaks the
// UI language, every line of it.
//
// What happened in the real environment (v0.1.76 release smoke, sijie.xyz in the zh UI): the modal's
// title and prompt were Chinese, but the kicker read "ACCESS GRANTED · CODE …", the greeting read
// "This is sijie's AI. Ask it anything — it answers in sijie's voice, grounded in their real work.",
// and the capacity line and both input placeholders were English. The kicker and placeholders were
// literals in VisitorNamePicker.tsx; the default greeting was assembled in English by the backend
// (defaultGreeting), and the capacity line in English by use-code-intro.ts — text built outside the
// catalog never gets translated.
//
// Each assertion is the exact zh copy, so passing means the zh catalog rendered it.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'zh-picker@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'zhpicker',
  fullName: 'Zh Picker Owner',
};
const CODE = 'ZHPICK-001'; // role without a greeting (the default greeting), max_members=3

test.describe('F-I-2 · the name picker is fully translated in the zh UI', () => {
  test.beforeAll(async ({ playwright }) => { await seed(playwright); });

  test('/zh/?code= → kicker, default greeting, capacity line and placeholders are Chinese',
    async ({ page }) => {
      await openReader(page, `/zh/?code=${CODE}`);
      await expect(page.getByTestId('visitor-name-greeting')).toHaveText(
        '这是 zhpicker 的 AI。尽管问——它用 zhpicker 的口吻回答，依据是其真实的作品。',
        { timeout: 15_000 },
      );
      await expect(page.getByTestId('visitor-name-capacity'))
        .toContainText('最多 3 人可以使用这个访问码——已有 0 人加入。');
      await expect(page.getByTestId('visitor-name-input')).toHaveAttribute('placeholder', '你的名字');
      await expect(page.getByTestId('visitor-email-input'))
        .toHaveAttribute('placeholder', '邮箱（可选，用于接收会议邀请）');
      await expect(page.getByTestId('visitor-name-kicker')).toHaveText(`已获准进入 · 访问码 ${CODE}`);
    });
});

async function seed(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await initMCP(request, await createAPIToken(request, csrf, 'zh-picker-seed'));
  const plain = await createRole(request, csrf, {
    name: 'Plain', description: 'no greeting — exercises the default', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'zh picker', assumed_role_id: plain.id, max_members: 3,
  });
  await request.dispose();
}
