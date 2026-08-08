// gate-skip-takes-a-name.spec.ts —— 「跳过填名字」也占一个名额,这件事得写在按钮旁边。
//
// 行为本身是对的(owner 已确认):点 skip 走 resolveAnonMember → CreateAnonymousMember,
// **每点一次都新建一条 member**,匿名这条路上没有「同一个人」的概念。所以同一个人点两次
// skip 就吃掉两个名额,而且第二次不会跟第一次归成一组。
//
// 但弹窗只解释了具名那一半 —— 「同名会归到一起,换名字就算新的人」—— 对 skip 一个字没说,
// skip 按钮上也只有 "skip"。真实环境审计里我自己就踩了:同一个 code 填了名字是 1/10,
// 点一次 skip 变 2/10,当场看不出为什么。我能踩,访客也会踩,而代价落在 owner 的配额上。
//
// 断的是**说明存在**,不是行为:行为已经是对的了。

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'skipnote@example.com', password: 'correct-horse-battery-staple',
  handle: 'skipnote', fullName: 'Skip Note Owner',
};

const CODE = 'SKIP-NOTE1';

test.describe('gate · the identity picker says what skipping costs', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // 有名额上限才谈得上「占一个」。
    await createCode(request, csrf, { code: CODE, label: 'skip note', max_members: 10 });
    await request.dispose();
  });

  test('the picker explains that skipping still uses one of the code names', async ({ page }) => {
    await goto(page, `/?code=${CODE}`);
    const skip = page.getByTestId('visitor-name-skip');
    await expect(skip).toBeVisible();

    // 解释名额规则的就是这一段;skip 的代价该跟具名规则待在一起。
    const copy = (await page.getByTestId('visitor-name-capacity').innerText()).toLowerCase();

    expect(copy, 'the picker must explain the named-reuse rule')
      .toContain('same name');
    // skip 的代价:它也吃一个名额。owner 的配额被消耗,访客却完全看不到。
    expect(copy, 'skipping must be described as taking one of the code names')
      .toMatch(/skip[\s\S]{0,160}name/);
  });
});
