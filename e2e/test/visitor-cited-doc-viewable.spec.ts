// visitor-cited-doc-viewable.spec.ts —— 持 code 的访客点引用 → 跳那篇 document
// 的页面 → 必须看得到全文,而不是「requires an access code」锁屏。
//
// 道理:访客凭 code 登录、role ACL 授了这篇(AI 就是凭这访问读出来答的),
// 那他当然该能查看。公开 landing 是 seo_indexed-only + 不认 session,所以非
// indexed 的被引文档落到锁屏 —— 这是 bug。修法:锁屏客户端拿 visitor session
// 走 corpus_read(ACL 评估)把全文取回来渲染。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession, goto } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';
const TARGET_BODY = 'lucerna is a local-first knowledge tool I built.';

test.describe('持 code 访客点引用 → 看得到被引文档(不落锁屏)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'cited-doc-seed');
    const sid = await initMCP(request, token);
    // 不设 seo_indexed → 公开 landing 会锁;但访客的 code/ACL 该放行。
    await seedWiki(request, token, sid, {
      body: TARGET_BODY, title: 'Lucerna', path: TARGET_PATH,
    });
    await createCode(request, csrf, { code: CODE, label: 'intro' });
    await request.dispose();
  });

  test('访客起会后直接开 /wiki/<被引 path> → 显全文,非锁屏',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // 起会 = localStorage 落 visitor session(token + conversation_id)。
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // 模拟点引用:同 context(session 在 localStorage)开那篇 doc 的公开 URL。
      await goto(page, `/wiki/${TARGET_PATH}`);

      // 凭 session 把全文取回渲染 —— wiki-body 出现且含原文,锁屏不在。
      await expect(page.getByTestId('wiki-body')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('wiki-body')).toContainText(TARGET_BODY);
      await expect(page.getByText('This entry requires an access code')).toHaveCount(0);

      await ctx.close();
    });
});
