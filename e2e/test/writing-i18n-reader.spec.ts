// writing-i18n-reader -- what happens when a multilingual **writing** gets read.
//
// F-R-5: the one published writing in the real vault uses exactly the i18n contract
// (`> [!i18n]` + `> > [!lang] en` + a `<label><input type=radio>` switcher), and
// `/writings/<slug>` **prints these verbatim into the body** -- the block markers and
// the switcher's entire HTML both show up as literal text in front of the reader.
//
// **This isn't a missing parser**: `internal/corpus/i18n` has Parse/Validate, and the
// read side that picks a pane is `corpus/usecase/corpus_i18n_read.go:42 ViewFor`.
// Checking its call sites finds only the landing layer and index/search --
// **the reader path was never wired up**.
//
// **Why the wiki side is fine**: `corpus-i18n-reader.spec.ts` covers the wiki reader,
// but the writings reader has never had a corresponding test. One capability got wired
// up halfway, and nothing was guarding the other half.
//
// The assertion uses the **inverse** of `.not.toContainText`: it reads the text first,
// then judges it -- because `.not.toContainText` also passes while the element hasn't
// appeared yet ([[negated-assertion-passes-while-absent]]).

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

// The shape is copied straight from the-business-model-wedge in the real vault: a
// neutral sentence outside the block, a switcher written as HTML by the owner, and two
// language panes.
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
      // Reads the text before judging it (see the file header).
      const text = await body.innerText();
      expect(text, 'the i18n block marker must be consumed, not printed')
        .not.toContain('[!i18n]');
      expect(text, 'the lang pane marker must be consumed, not printed')
        .not.toContain('[!lang]');
      expect(text, "the owner's switcher markup must render, not appear as text")
        .not.toContain('<input type="radio"');
      // Prose outside the block belongs to no particular language, and is always shown.
      expect(text, 'neutral prose outside the block always shows')
        .toContain('The shared epigraph');
    });

  // F-R-6: the second layer that shows up immediately after F-R-5 is fixed -- the source
  // no longer leaks, but the reader **still can't switch languages either**.
  // The wiki reader has a real `EN 中文` switcher (`LanguageSwitch`, testid
  // `language-switch`); the writings reader has nothing at all: you get the English
  // pane with no way to know Chinese exists too.
  //
  // Asserts that switching **actually works**, not just "there are two copies in the
  // DOM" -- the latter would still pass green under an implementation that ships both
  // languages and hides one with CSS, which is exactly what copying Obsidian's approach
  // verbatim would produce.
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
      // After switching, the English pane is **gone from the DOM entirely** (not merely
      // hidden).
      expect(await body.innerText(), 'the other pane is gone, not hidden')
        .not.toContain('Attack the business model');
    });

  // Switching language **must not trigger a full page reload**.
  //
  // The test above only asserts "the content switched" -- a full page reload would also
  // make that pass, so it's blind to this particular failure mode. The switcher used to
  // be a bare `<a href>`: a reader mid-read switches language, the entire document
  // reloads, the page flashes white, and the scroll position resets to the top. The URL
  // does need to change (so the link is shareable, so a crawler can reach that pane),
  // but **none of those three reasons requires a reload** -- `next/link`'s client-side
  // navigation satisfies all of them.
  //
  // The criterion is deterministic: a reload wipes out everything on window. A marker is
  // set on window first, and it's still there after switching = no reload happened --
  // rather than counting network requests or comparing timing (both of those are only
  // proxy signals).
  // The scroll-position half of this **has no guard**: the article this file seeds is
  // too short for the page to scroll at all, so "still in the same place after
  // switching" would be vacuously true. The first version of this test wrote that
  // assertion, and its own positive control (first asserting it had genuinely scrolled
  // down) blocked it on the spot -- a vacuously-true assertion is worse than no assertion
  // ([[assertion-that-cannot-fail]]). Guarding it properly needs a long enough seed
  // article, and this file's seed is already asserted on by content by tests in the same
  // group, so it shouldn't be changed for this one test. `scroll={false}` is still sent
  // as before, this just doesn't pretend to test it here.
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
