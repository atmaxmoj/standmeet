// corpus-tree-epoch-inflight.spec.ts —— **新建的那一条必须出现在树上,哪怕树正在取。**
//
// ①🔴 全量第 723 条红在这里:标题写着 `wiki · 5 entries`、侧栏 pulse 也说 5,而树上只有 4 行 ——
// 少的正是刚新建的那一条。等了 15 秒没等到:它不是慢,是**卡死了**。
//
// ②🎯 `useAdminTreeLayer` 用两个 effect 表达作废:一个 `setNodes(null)`(按 epoch),一个
// 「nodes 是 null 就去取」。作废那一步在 nodes **本来就是 null** 时是个空动作 —— React 对
// 同值 setState 直接 bail out,不重渲、不重跑第二个 effect。于是这条路走成:
//
//   进页面 → 树开始取(还没回) → owner 新建一条 → epoch++ → `setNodes(null)` 无效 →
//   在途的那份**旧**名单回来了 → `nodes !== null` → 从此不再取。
//
// 屏幕上就是「计数说 5、列表 4 行」,而且永远不会自己好。真 owner 撞它的条件只是
// **在列表转完之前动手** —— 网络越慢越容易,而慢网络下的人恰恰最想早点动手。
//
// ③🧪 这条 spec 把那个窗口做成**确定的**:树那一口的回参被扣住(请求真发出去了、答案在手上、
// 浏览器还没拿到),新建就落在这中间。扣多久不由计时决定 —— 由测试自己放行,所以窗口
// 不会因为机器快慢提前关掉。

import type { Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'tree-epoch@example.com', password: 'correct-horse-battery-staple',
  handle: 'treeepoch', fullName: 'Tree Epoch Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('corpus tree · creating while the tree is still fetching', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('an entry created mid-fetch still shows up in the tree', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');
    // 先有一条:空语料渲的是 EmptyState,树根本不挂载,那样这条测不到东西。
    await createWiki(page, 'tree seed note');
    await expect(rowFor(page, 'tree seed note')).toBeVisible({ timeout: 15_000 });

    // marks —— 这条 spec **必须自证它打到了那个窗口**。三个时刻的顺序不对,
    // 它测的就是另一条路,而绿得跟真的一样。
    const marks: { fetched: number[]; delivered: number[]; created: number[] } = {
      fetched: [], delivered: [], created: [],
    };
    // release —— 扣住的回参什么时候放行。**用信号不用计时**:计时长短要跟机器快慢赛跑,
    // 而输掉的那一遍长得跟通过一模一样。
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    // **先真发出去,再扣住回参**。扣在 `continue()` 之前只是把整个请求推迟到新建之后 ——
    // 那样服务器回的是新数据,树当然是对的。在途的意思是:名单已经在服务器那边定死
    // (新建之前的那份),浏览器还没拿到。
    await page.route('**/corpus/wiki/tree*', async (route) => {
      const res = await route.fetch();
      const body = await res.body();
      marks.fetched.push(Date.now());
      await held;
      await route.fulfill({ response: res, body });
      marks.delivered.push(Date.now());
    });
    page.on('response', (res) => {
      const path = new URL(res.url()).pathname;
      const isCreate = res.request().method() === 'POST' && /\/corpus\/wiki$/.test(path);
      isCreate && marks.created.push(Date.now());
    });
    await page.reload();

    // **等旧名单被钉死再动手**,而不是「抢在前面动手」。树那一口什么时候发出去不由这条
    // spec 决定(它排在扁平列表之后),抢跑就变成一场比赛 —— 而比赛有时会输。
    await expect.poll(() => marks.fetched.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await createWiki(page, 'tree race note');
    await expect.poll(() => marks.created.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(marks.delivered.length, 'the stale list has not reached the browser yet').toBe(0);
    expect(
      marks.created[0] ?? 0,
      'the create must land after the stale list was pinned',
    ).toBeGreaterThan(marks.fetched[0] ?? Number.MAX_SAFE_INTEGER);
    release();

    // 这一条必须出现。给的时间远超放行本身:要判的是「它到底会不会出现」,不是「够不够快」。
    await expect(
      rowFor(page, 'tree race note'),
      'an entry created while the tree was fetching must appear after the tree refetches',
    ).toBeVisible({ timeout: 30_000 });
    // 而且原来那条还在 —— 修法不许靠「整棵树重来一遍丢掉状态」。
    await expect(rowFor(page, 'tree seed note')).toBeVisible();
  });
});

function rowFor(page: Page, title: string) {
  return page.locator('[data-testid^="wiki-row-"]').filter({ hasText: title }).first();
}

async function createWiki(page: Page, title: string): Promise<void> {
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(title);
  await page.getByTestId('wiki-create-body').fill('a note in the tree');
  await page.getByTestId('wiki-create-submit').click();
}
