// wiki-reader-shell-persists.spec.ts —— 换一篇文章时，**外壳不重挂**；读正文时，**外壳不动**。
//
// 现场（prod）：点树里另一篇文章，整棵树闪一下重新渲；往下读正文，顶栏和树跟着一起卷走。
//
// 成因是同一个：顶栏和树写在 `wiki/page.tsx` 和 `wiki/[...path]/page.tsx` **各自里面**。
// Next 在同级页面之间导航时会保留 layout、只换 page —— 但那两样住在 page 里，
// 于是每点一篇文章整个骨架重挂（树重渲、每层重拉），而且三者在同一个滚动流里。
// （`admin` 早就是 layout，所以它换分区侧栏不闪。同一个结构，wiki 这边一直没有。）
//
// 两条判据都不看样式，看**行为**：
//
//   ① 不重挂 —— 在树那个真实 DOM 节点上挂一个 expando 属性（React 不碰它），换文章之后
//      它还在。节点被重建的话属性没了。比"展开状态还在"强：后者可以靠 store 恢复出来，
//      看起来一样而实际仍然重挂了一遍（[[assertion-that-cannot-fail]] 的邻居：
//      判据要能区分"没重挂"和"重挂了但看起来一样"）。
//
//   ② 各滚各的 —— 滚正文那一列，顶栏在视口里的位置必须一动不动。
//      先断言正文真的滚动了，否则"顶栏没动"在页面根本滚不动时是恒真的。
//
// RED（修复前）：① 属性丢失（page 里的骨架被重挂）；② 顶栏跟着一起走。

import { test, expect, type Page } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'reader-shell@example.com',
  password: 'the-shell-outlives-the-page-1',
  handle: 'shellowner',
  fullName: 'Shell Owner',
};

const FIRST = { title: 'First entry', path: 'first-entry' };
const SECOND = { title: 'Second entry', path: 'second-entry' };
// 正文要够长才滚得动 —— 判据②在滚不动的页面上是恒真的。
const LONG_BODY = Array.from({ length: 120 },
  (_, i) => `Paragraph ${i + 1}. The reader scrolls this column and the shell stays put.`
).join('\n\n');

test.describe.configure({ timeout: 180_000 });

test.describe('wiki 阅读器外壳：换文章不重挂，读正文不跟着滚', () => {
  test.beforeAll(async ({ playwright }) => {
    // `describe.configure({ timeout })` 只管测试体，**管不到 hook** —— hook 有自己的
    // 30s 默认值。种两篇长文要重置实例 + 认领 + 建两条并发布，撞得到那个数，
    // 而红会报在 hook 上，看着像产品的问题（[[red-in-the-wrong-place]]）。
    test.setTimeout(180_000);
    await seedTwoEntries(playwright);
  });

  test('换一篇文章，树这个 DOM 节点没有被重建', async ({ page }) => {
    await goto(page, `/wiki/${FIRST.path}`);
    await expect(page.getByTestId('wiki-toc')).toBeVisible({ timeout: 15_000 });

    // expando 属性：React 不管它，节点活着它就在，节点被重建就没了。
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="wiki-toc"]');
      (el as unknown as Record<string, unknown>)['__shellProbe'] = 1;
    });

    // 从树里点另一篇 —— 这正是读者换文章的动作。
    await page.getByTestId(`tree-node-${SECOND.path}`).getByRole('link').first().click();
    await page.waitForURL(new RegExp(`/wiki/${SECOND.path}$`));
    await expect(page.getByTestId('wiki-body'), '真的换到了第二篇')
      .toContainText('Paragraph 1.', { timeout: 15_000 });

    const survived = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="wiki-toc"]');
      return (el as unknown as Record<string, unknown>)['__shellProbe'];
    });
    expect(survived, '树被重建了 —— 换文章时整个外壳重挂了一遍').toBe(1);
  });

  test('滚正文，顶栏留在原地', async ({ page }) => {
    await goto(page, `/wiki/${SECOND.path}`);
    await expect(page.getByTestId('wiki-body')).toBeVisible({ timeout: 15_000 });

    const before = await shellTop(page);
    const moved = await scrollArticle(page);
    expect(moved, '正文真的滚动了，否则下面那条是恒真的').toBeGreaterThan(100);

    expect(await shellTop(page), '顶栏跟着正文一起滚走了').toBe(before);
  });
});

// shellTop —— 顶栏在**视口**里的位置。外壳固定的话，滚正文不改变它。
async function shellTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="wiki-topbar"]');
    return bar ? Math.round(bar.getBoundingClientRect().top) : -1;
  });
}

// scrollArticle —— 滚正文那一列（它自己的滚动容器；退回窗口滚动以便在**修复前**也能驱动），
// 返回正文实际移动了多少。
async function scrollArticle(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const body = document.querySelector('[data-testid="wiki-body"]');
    const before = body!.getBoundingClientRect().top;
    const col = document.querySelector('[data-testid="wiki-scroll"]');
    if (col && col.scrollHeight > col.clientHeight) col.scrollTop = 600;
    else window.scrollTo(0, 600);
    // 等**滚动这件事本身**发生（scroll 事件），不是数毫秒。
    await new Promise<void>((resolve) => {
      const target: EventTarget = col ?? window;
      const done = (): void => { target.removeEventListener('scroll', done); resolve(); };
      target.addEventListener('scroll', done, { once: true });
      // 已经滚到位、事件不会再来时也要收场：读一次当前位置就知道。
      if (Math.abs(before - body!.getBoundingClientRect().top) > 0) done();
    });
    return Math.abs(before - body!.getBoundingClientRect().top);
  });
}

async function seedTwoEntries(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'reader-shell-seed');
  const sid = await initMCP(request, token);
  for (const e of [FIRST, SECOND]) {
    const { wikiID } = await seedWiki(request, token, sid, {
      body: LONG_BODY, title: e.title, path: e.path,
    });
    await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID });
  }
  await request.dispose();
}
