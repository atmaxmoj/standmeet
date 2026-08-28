// writing-i18n-reader —— 一篇多语 **writing** 被人读的时候。
//
// F-R-5：真 vault 里唯一一篇已发布的 writing 用的就是 i18n 契约
// （`> [!i18n]` + `> > [!lang] en` + 一个 `<label><input type=radio>` 切换器），
// 而 `/writings/<slug>` 把这些**原样印成正文** —— 区块标记和切换器的整段 HTML
// 全都以字面文本出现在读者眼前。
//
// **不是解析器缺失**：`internal/corpus/i18n` 有 Parse/Validate，读侧挑面板的是
// `corpus/usecase/corpus_i18n_read.go:42 ViewFor`。查它的调用点只有 landing 那一层和
// 索引/搜索 —— **reader 这条路没接上**。
//
// **为什么 wiki 那边是好的**：`corpus-i18n-reader.spec.ts` 覆盖的是 wiki reader，
// writings reader 从来没有对应的用例。一个能力接了一半，另一半没有守卫看着。
//
// 断言取 `.not.toContainText` 的**反面写法**：先取文本再判断 —— 元素还没出现时
// `.not.toContainText` 也算通过（[[negated-assertion-passes-while-absent]]）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'i18nwriting@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'i18nwriting',
  fullName: 'I18n Writing Owner',
};

// 形状照抄真 vault 里那篇 the-business-model-wedge：区块外一句中性散文，
// 切换器是 owner 自己写的 HTML，两个语言面板。
const BODY = [
  'The shared epigraph, in no language in particular.',
  '',
  '> [!i18n]',
  '> <label><input type="radio" name="wedge-lang" checked>EN</label>'
  + '<label><input type="radio" name="wedge-lang">中文</label>',
  '>',
  '> > [!lang] en',
  '> > # Attack the business model',
  '> > English prose about the wedge.',
  '>',
  '> > [!lang] zh',
  '> > # 攻击商业模式',
  '> > 关于楔子的中文正文。',
  '',
  'The closing line, also neutral.',
].join('\n');

test.describe('a multilingual writing reads as content, not as source', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedOwnerAndWriting(playwright);
  });

  test('the reader shows neither the block markers nor the switcher HTML (F-R-5)',
    async ({ page }) => {
      await goto(page, '/writings/i18n-wedge');
      const body = page.getByTestId('writing-article-body');
      await expect(body).toBeVisible({ timeout: 10_000 });
      // 先取文本再判断（见文件头）。
      const text = await body.innerText();
      expect(text, 'the i18n block marker must be consumed, not printed')
        .not.toContain('[!i18n]');
      expect(text, 'the lang pane marker must be consumed, not printed')
        .not.toContain('[!lang]');
      expect(text, "the owner's switcher markup must render, not appear as text")
        .not.toContain('<input type="radio"');
      // 区块外的散文属于任何语言，永远在。
      expect(text, 'neutral prose outside the block always shows')
        .toContain('The shared epigraph');
    });

  // F-R-6：F-R-5 修完之后立刻显形的第二层 —— 源码不漏了，但读者**也换不了语言**。
  // wiki reader 有真的 `EN 中文` 切换器（`LanguageSwitch`，testid `language-switch`），
  // writings reader 什么都没有：拿到英文那一面，无从知道还有中文。
  //
  // 断言的是**能切**，不是"DOM 里有两份" —— 后者在「两种语言都发下来、用 CSS 藏一种」
  // 的实现下也会绿，而那正是照抄 Obsidian 会写出来的东西。
  test('the reader can switch to the other language (F-R-6)',
    async ({ page }) => {
      await goto(page, '/writings/i18n-wedge');
      const body = page.getByTestId('writing-article-body');
      await expect(body).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('language-switch'),
        'a multilingual writing must offer its languages').toBeVisible();

      await page.getByTestId('language-switch').getByText('中文').click();
      await expect.poll(async () => (await body.innerText()).includes('攻击商业模式'),
        { message: 'switching must actually bring the other pane', timeout: 10_000 })
        .toBe(true);
      // 换过去之后，英文那一面**不在 DOM 里**（不是藏起来）。
      expect(await body.innerText(), 'the other pane is gone, not hidden')
        .not.toContain('Attack the business model');
    });

  // 切语言**不许整页重载**。
  //
  // 上面那条用例只断言「内容换了」—— 而整页重载也会让它绿，所以它对这件事是瞎的。
  // 切换器原本是裸 `<a href>`：读者读到一半切个语言，整份文档重新加载，页面白一下、
  // 滚动位置丢回顶部。地址要换（链接可分享、爬虫拿到那一面），但那三条理由**没有一条
  // 需要重载**，`next/link` 的客户端导航全都满足。
  //
  // 判据是确定性的：重载会抹掉 window 上的一切。先在 window 上做个记号，切完还在
  // 就是没重载 —— 而不是去数网络请求或者比时间（那两样都是代理指标）。
  // 滚动位置那一半**没有守卫**：这个文件种的文章太短，页面根本滚不动，
  // 于是「切完还在原处」是恒真的。第一版写了那条断言，而它自己的正对照
  // （先断言真的滚下去了）当场把它挡了下来 —— 恒真的断言不如没有
  // （[[assertion-that-cannot-fail]]）。要守它得有一篇够长的种子，而这个文件的种子
  // 被同组别的用例按内容断言着，不该为这一条改。`scroll={false}` 照常发，只是这里不假装测了它。
  test('切语言不重载整页', async ({ page }) => {
    await goto(page, '/writings/i18n-wedge');
    const body = page.getByTestId('writing-article-body');
    await expect(body).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() => { (window as unknown as Record<string, unknown>)['__notReloaded'] = 1; });

    await page.getByTestId('language-switch').getByText('中文').click();
    await expect.poll(async () => (await body.innerText()).includes('攻击商业模式'),
      { message: '切换要真的换过去', timeout: 10_000 }).toBe(true);

    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__notReloaded']),
      '整页重载会把这个记号抹掉').toBe(1);
  });
});

interface WritingInput {
  slug: string; title: string; excerpt: string; body_md: string;
  cover_headline: string; cover_hue: string; tags: string[];
}

async function seedOwnerAndWriting(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await mcpCreateWriting(request, 'i18n-writing-token', {
    slug: 'i18n-wedge', title: 'I18n wedge',
    excerpt: 'A multilingual writing straight out of the vault contract.',
    body_md: BODY,
    cover_headline: 'i18n.', cover_hue: 'amber', tags: ['i18n'],
  });
  await request.dispose();
}

async function mcpCreateWriting(
  request: APIRequestContext, tokenName: string, in_: WritingInput,
): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, tokenName);
  const sid = await initMCP(request, apiToken);
  await callTool<{ writing_id: string }>(request, apiToken, sid, 'writing_create', {
    ...in_, publish: true,
  });
}
