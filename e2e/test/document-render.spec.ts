// document-render.spec.ts —— wiki landing renders every markdown feature
// through ChatMarkdown (gfm / katex / mermaid / xss sanitize / basic markdown).
//
// Previously this went through the /dev/chat-render?fixture=... fixture page.
// After G-6 removed the dev route, this now goes through the real prod path:
// seed a wiki entry whose body is each fixture, visit /wiki/<path>. Same
// ChatMarkdown component, same plugin set, same .chat-md scope — testing this
// equals testing prod.

import { test, expect, type APIRequestContext, type Page } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

// FIXTURE_BODIES —— one body per markdown feature. Once seeded, each lands
// at its own path; the spec visits /wiki/<path> directly.
const FIXTURE_BODIES = {
  markdown: [
    '# Heading',
    '',
    'A paragraph with **bold**, *italic*, and `inline code`.',
    '',
    '- item one',
    '- item two',
    '',
    '[link](https://example.com)',
  ].join('\n'),

  // cjk —— **emphasis inside Chinese text**. This is a separate case because
  // it exercises a different rule than the block above: CommonMark decides
  // whether `**` closes by checking "right-flanking" — the character before it
  // must not be punctuation, unless the character after is whitespace or
  // punctuation. English `**bold**,` naturally satisfies this (followed by a
  // comma); Chinese `**……ad.**this sentence` does not (preceded by `。`,
  // followed by a CJK character), so the closing fails and the whole span
  // degrades to literal asterisks.
  // The block above has always tested emphasis, but only ever exercised the
  // side of the rule where it **happens to hold**.
  cjk: [
    '它的整个产品就是一句话：**我们不拿你的访客数据卖广告。**这句话 Google 说不出口。',
    '',
    '**Tally 对 Typeform。**Typeform 按收到的回复数收费。',
  ].join('\n'),

  gfm: [
    '| col1 | col2 |',
    '| ---- | ---- |',
    '| a    | b    |',
    '',
    '~~strike~~',
    '',
    'https://example.com',
  ].join('\n'),

  katex: [
    'Inline: $E = mc^2$',
    '',
    'Display:',
    '',
    '$$',
    '\\int_0^1 x^2 dx',
    '$$',
  ].join('\n'),

  mermaid: [
    '```mermaid',
    'graph LR; A-->B',
    '```',
  ].join('\n'),

  xss: [
    'Before',
    '',
    '<script>window.__pwned = true</script>',
    '',
    '<img src="x" onerror="window.__pwned_img = true" />',
    '',
    'After',
  ].join('\n'),
} as const;

type FixtureKey = keyof typeof FIXTURE_BODIES;

test.describe('document body (wiki landing) ChatMarkdown 渲染', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedAllFixtures(request);
    await request.dispose();
  });

  test('基础 markdown · heading / bold / italic / inline code / list / link',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('markdown')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body).toBeVisible();
      await expect(body.locator('h1')).toHaveText('Heading');
      await expect(body.locator('strong').first()).toHaveText('bold');
      await expect(body.locator('em').first()).toHaveText('italic');
      await expect(body.locator('code').first()).toHaveText('inline code');
      await expect(body.locator('ul li').first()).toContainText('item one');
      await expect(body.locator('a').first()).toHaveAttribute('href', 'https://example.com');
    });

  // Chinese `**bold.**` must render as bold, not as four literal asterisks
  // on screen.
  //
  // The criterion is **a strong element got rendered**, not "no asterisks in
  // the text" — the latter would also pass if the whole block failed to
  // render at all. Both must hold: the asterisks became a tag, and that tag
  // contains the sentence.
  test('cjk · 中文里的 **强调** 是强调，不是字面星号',
    async ({ page }) => { await assertCjkEmphasis(page); });

  test('gfm · table / strikethrough / autolink',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('gfm')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body.locator('table')).toBeVisible();
      await expect(body.locator('table th').first()).toContainText('col1');
      await expect(body.locator('table td').first()).toContainText('a');
      await expect(body.locator('del')).toHaveText('strike');
      await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com');
    });

  test('katex · inline + display 都有 .katex / .katex-display 元素',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('katex')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body.locator('.katex').first()).toBeVisible();
      await expect(body.locator('.katex-display')).toBeVisible();
    });

  test('mermaid · ```mermaid block 异步渲染 <svg>',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('mermaid')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body.getByTestId('mermaid-svg').locator('svg'))
        .toBeVisible({ timeout: 10_000 });
    });

  test('xss sanitize · <script> 被剔除 + onerror 不触发',
    async ({ page }) => {
      await goto(page, `/wiki/${pathFor('xss')}`);
      const body = page.getByTestId('wiki-body');
      await expect(body).toContainText('Before');
      await expect(body).toContainText('After');
      await expect(body.locator('script')).toHaveCount(0);
      // The malicious <img onerror> should be stripped entirely by sanitize —
      // assert it doesn't exist (web-first assertions auto-retry while the
      // DOM settles); with no img at all, onerror never gets a chance to fire.
      await expect(body.locator('img')).toHaveCount(0);
      const pwned = await page.evaluate(
        () => Boolean((window as unknown as { __pwned?: boolean }).__pwned)
          || Boolean((window as unknown as { __pwned_img?: boolean }).__pwned_img),
      );
      expect(pwned).toBe(false);
    });
});

// The address tree derives URL = title slug. title `Render fixture · ${key}` → render-fixture-${key}.
function pathFor(key: FixtureKey): string {
  return `render-fixture-${key}`;
}

// assertCjkEmphasis —— Chinese `**bold.**` must render as strong.
//
// The criterion is **a strong element got rendered**, not "no asterisks in
// the text" — the latter would also pass if the whole block failed to render
// at all. Both must hold: the asterisks became a tag, and that tag contains
// the sentence.
async function assertCjkEmphasis(page: Page): Promise<void> {
  await goto(page, `/wiki/${pathFor('cjk')}`);
  const body = page.getByTestId('wiki-body');
  await expect(body).toBeVisible();
  await expect(body.locator('strong').first(), '`**` 闭合了,渲成了 strong')
    .toHaveText('我们不拿你的访客数据卖广告。');
  await expect(body.locator('strong').nth(1), '第二处同样,不是只有第一处侥幸')
    .toHaveText('Tally 对 Typeform。');
  // The half that can go negative: only after the two assertions above pin
  // down that the emphasis is really there does this one stop being
  // vacuously true on an empty page.
  await expect(body, '星号不许出现在屏幕上').not.toContainText('**');
}

async function seedAllFixtures(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'document-render-seed');
  const sid = await initMCP(request, token);
  for (const key of Object.keys(FIXTURE_BODIES) as FixtureKey[]) {
    const path = pathFor(key);
    const { wikiID } = await seedWiki(request, token, sid, {
      body: FIXTURE_BODIES[key],
      title: `Render fixture · ${key}`, path,
    });
    await publishEntry(request, token, sid, {
      genre: 'wiki', id: wikiID, excerpt: `${key} render fixture.`,
    });
  }
}
