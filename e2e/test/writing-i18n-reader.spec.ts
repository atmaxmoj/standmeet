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
