// corpus-two-saves.spec.ts —— 一屏两个提交，每个必须自报管哪一半（UX-60）。
//
// 缺陷的形状：wiki 的编辑屏是上下两张卡 —— 上面 CorpusEntryForm（标题/正文/标签/封面），
// 下面 PUBLIC LANDING（excerpt + published）。**它们各有各的提交，写的是不同的后端调用**，
// 而两个按钮原本都只写 `save`。owner 填完下半张卡，最自然的动作是去按上面那个更大更显眼的
// 实心按钮 —— 而它不管下半张。屏幕上没有边界提示，也没有"未保存"标记。
//
// 守的是**每个按钮点名自己的那一半**。这是 owner 唯一能据以判断"该按哪个"的信息，
// 所以它是产品行为，不是文案偏好：退回 `save` / `save` 就是把那次误按重新装回去。
//
// 为什么不去断"按了上面那个，下面的没存"：那是在给缺陷本身立证，修好之后它照样成立
// （两个提交本来就该各管各的）。真正会随修复翻转的判据是**按钮说不说得清**。

import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'twosaves@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'twosaves',
  fullName: 'Two Saves Owner',
};

const TITLE = 'Entry With A Landing Card';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial' });
test.describe('corpus · two submits on one screen, each says which half it saves', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the entry submit and the landing submit name their own half', async ({ adminPage }) => {
    await createEntry(adminPage);
    const id = await openEditForm(adminPage, TITLE);

    const entrySave = adminPage.getByTestId(`wiki-edit-form-${id}-submit`);
    const landingSave = adminPage.getByTestId(`wiki-${id}-seo-save`);
    await expect(landingSave, 'the landing card carries its own submit').toBeVisible();

    // 两个都在场、都可见 —— 然后各自的字必须说清管的是哪一半。
    await expect(
      entrySave,
      'the entry submit must say it saves the entry, not just "save"',
    ).toHaveText(/save\s+entry/i);
    await expect(
      landingSave,
      'the landing submit must say it saves the landing, not just "save"',
    ).toHaveText(/save\s+landing/i);
  });
});

async function createEntry(page: Page): Promise<void> {
  await gotoAdminSection(page, 'wiki');
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(TITLE);
  await page.getByTestId('wiki-create-body').fill('Something with a public landing side.');
  await page.getByTestId('wiki-create-submit').click();
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });
}

// openEditForm —— 展开这一行的编辑表单，返回它的 id。表单是懒加载的：点开先是 loading…，
// 所以要等 `wiki-edit-loaded-${id}`，不能等字段可见就动手。
async function openEditForm(page: Page, title: string): Promise<string> {
  await gotoAdminSection(page, 'wiki');
  const row = page.locator('[data-testid^="wiki-row-"]', { hasText: title });
  await expect(row).toBeVisible({ timeout: 10_000 });
  const id = (await row.getAttribute('data-testid'))!.replace('wiki-row-', '');
  await page.getByTestId(`wiki-edit-${id}`).click();
  await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
  return id;
}
