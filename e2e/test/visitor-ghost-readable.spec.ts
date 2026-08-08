// visitor-ghost-readable.spec.ts —— F-A-25: ghost 必须**读得完**。
//
// ghost 一直是当作 textarea 的 `placeholder` 属性渲的。placeholder 不换行:一行,到元素宽度就裁,
// 没有省略号。而 ghost 是模型生成的任意长度散文,于是每一条长一点的都在半句话处断掉 —— 访客
// 永远看不到后半截,也就永远不知道它在把自己往哪儿引。
//
// 这不是容器不够大:同一条串按 Tab 收进同一个框当 **value**,textarea 自己撑高、换行、完整可读。
// 装不下的是投递方式,不是盒子。
//
// 判据必须是**几何**的,不能读文本 —— `data-ghost` 属性和 innerText 在被裁的时候一模一样,
// 现有的 visitor-chat-ghost.spec.ts 就是这么绿的。所以这里断三件事:
//   1. ghost 有一个真的渲染元素(不只是一个属性);
//   2. 它没有横向溢出(scrollWidth <= clientWidth)—— 一行 nowrap 会在这里红;
//   3. 它至少占了两行高 —— 证明它真换行了,而不是被 overflow:hidden 藏起来。
//
// RED(修复前):ghost 只存在于 placeholder 属性里,元素不存在 → 第一条就红。

import { test, expect } from '@/fixtures/test';
import type { Locator, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'ghost-readable@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ghostread',
  fullName: 'Ghost Readable Owner',
};
const CODE = 'GHOSTREAD-001';

// 真实长度的 ghost —— prod 上观察到的那几条就是这个量级("You mentioned your frameworks. I noticed
// you have a note called 'recursive-harness' — is that another one? I'd like to read it.")。
// 短串在窄框里也可能碰巧放得下,那样的绿说明不了任何事。
const LONG_GHOST =
  'You mentioned your frameworks. I noticed you have a note called '
  + "'recursive-harness' — is that another one? I'd like to read it.";

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('visitor ghost · 读得完 · F-A-25', () => {
  test('长 ghost 渲成一个会换行的元素,不横向溢出', async ({ page }) => {
    await enterCodeSession(page, CODE, 'Reader');
    const ghost = page.getByTestId('chat-ghost-text');
    await expect(ghost, 'ghost 要有一个真的渲染元素,不能只活在一个属性里')
      .toBeVisible({ timeout: 10_000 });
    await expect(ghost, 'ghost 元素带的就是那条完整的 ghost').toHaveText(LONG_GHOST);

    const box = await overflow(ghost);
    expect(
      box.scrollWidth,
      `ghost 不得横向溢出(裁字):scrollWidth=${box.scrollWidth} clientWidth=${box.clientWidth}`,
    ).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(
      box.height,
      `这条 ghost 一行放不下,必须换行:height=${box.height} lineHeight=${box.lineHeight}`,
    ).toBeGreaterThan(box.lineHeight * 1.5);
  });

  // ghost 在场时输入框自己的 placeholder 必须让位成空。第一版修复没让,于是 "ask…" 压在 ghost
  // 第一行上叠成一团 —— 上面那条几何断言全绿,因为它量的是 ghost 元素,量不出背后还压着另一串字。
  // 这条是拿眼睛在 prod 上看出来的,补回来当闸门。
  test('ghost 在场时,输入框自己的 placeholder 让位(不叠字)', async ({ page }) => {
    await enterCodeSession(page, CODE, 'NoOverlap');
    await expect(page.getByTestId('chat-ghost-text')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId('chat-input-field'),
      'ghost 覆盖层和 placeholder 不能同时画在同一格上',
    ).toHaveAttribute('placeholder', '');
  });

  test('Tab 仍然把完整的一条收进输入框', async ({ page }) => {
    await enterCodeSession(page, CODE, 'Tabber');
    const input = page.getByTestId('chat-input-field');
    await expect(page.getByTestId('chat-ghost-text')).toBeVisible({ timeout: 10_000 });
    await input.focus();
    await input.press('Tab');
    await expect(input, 'Tab 接受的是完整的一条,不是被裁的那半句').toHaveValue(LONG_GHOST);
  });

  test('访客一开始打字,ghost 就让位', async ({ page }) => {
    await enterCodeSession(page, CODE, 'Typer');
    const input = page.getByTestId('chat-input-field');
    await expect(page.getByTestId('chat-ghost-text')).toBeVisible({ timeout: 10_000 });
    await input.fill('my own question');
    await expect(
      page.getByTestId('chat-ghost-text'),
      '输入框里有字之后 ghost 不该还压在上面',
    ).toHaveCount(0);
  });
});

interface GhostBox {
  clientWidth: number;
  scrollWidth: number;
  height: number;
  lineHeight: number;
}

// overflow —— 量这个元素的横向溢出 + 实际高度 + 一行有多高。文本断言分不出「渲染了」和
// 「被裁了」,所以判据只能是几何的。
async function overflow(el: Locator): Promise<GhostBox> {
  return await el.evaluate((n: HTMLElement) => ({
    clientWidth: n.clientWidth,
    scrollWidth: n.scrollWidth,
    height: n.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(n).lineHeight),
  }));
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'ghostread-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    title: 'Alpha', body: 'Alpha shipped last quarter.', path: 'alpha',
  });
  const role = await createRole(request, csrf, {
    name: 'ghost-read-role', description: 'ghost readability spec',
    corpus_uris: ['wiki://**'],
    waypoints: [{
      waypoint_id: 'grasp-alpha', description: 'understand Alpha',
      weight: 5, evidence_refs: ['wiki://alpha'], is_terminal: false,
    }],
  });
  // initial ghost 走 code.ghosts 首条 —— 不用等一轮模型回答就能看到输入框里的那条。
  await createCode(request, csrf, {
    code: CODE, label: 'ghostread', assumed_role_id: role.id, ghosts: [LONG_GHOST],
  });
  await request.dispose();
}
