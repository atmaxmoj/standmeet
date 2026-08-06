// corpus-i18n-reader.spec.ts —— a multilingual note read by a person.
//
// The characteristic false green here is `expect(getByText('…')).toBeVisible()`: it passes under a
// "ship both languages, hide one with CSS" implementation — which is exactly what copying Obsidian
// produces. So the other language is asserted with **toHaveCount(0)**: not in the DOM at all.
//
// The most valuable test is the neutral prose one. A note is not N documents; the sentences outside
// the `[!i18n]` block belong to no language and appear under every one. An implementation that
// splits the note per language passes every other test here and fails only that one.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { seedWiki } from '@/fixtures/corpus';
import { goto } from '@/fixtures/navigate';
import { setPublished, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';

let O: RetrievalOwner;
let wikiID = '';

// A real multilingual note: two regions with NEUTRAL prose between them, three languages.
// The vault has no three-language note anywhere, so N>2 is untested by the material — the fixture
// has to invent one, or "N is unbounded" is a claim nothing checks.
const BODY = [
  'The shared epigraph, in no language in particular.',
  '',
  '> [!i18n]',
  '> <label><input type="radio" name="x" checked>EN</label><label>中文</label>',
  '>',
  '> > [!lang] en',
  '> > # The fixed point',
  '> > English prose about dynamics.',
  '>',
  '> > [!lang] zh',
  '> > # 不动点',
  '> > 关于动力学的中文正文。',
  '>',
  '> > [!lang] ja',
  '> > # 不動点',
  '> > 力学についての日本語の本文。',
  '',
  'A neutral sentence between the two regions.',
  '',
  '> [!i18n]',
  '> > [!lang] en',
  '> > A second English region.',
  '>',
  '> > [!lang] zh',
  '> > 第二个中文区块。',
  '>',
  '> > [!lang] ja',
  '> > 二番目の日本語の区画。',
].join('\n');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }) => {
  O = await setupRetrievalOwner(playwright, 'i18nreader');
  const seeded = await seedWiki(O.request, O.apiToken, O.sid, {
    title: 'Dynamics', path: 'projects/dynamics', body: BODY,
  });
  wikiID = seeded.wikiID;
  await setPublished(O.request, O.csrf, wikiID, true);
});

test.afterAll(async () => { await O.request.dispose(); });

async function readIn(page: Page, lang: string) {
  const q = lang === '' ? '' : `?lang=${lang}`;
  await goto(page, `/wiki/projects/dynamics${q}`);
  await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 10_000 });
}

test.describe('multilingual reader · one note, one language at a time', () => {
  test('the default render carries one language and NOT the others', async ({ page }) => {
    await readIn(page, '');
    const body = page.getByTestId('wiki-landing');
    await expect(body, 'the identity language is served').toContainText('English prose about');
    // Not "hidden" — absent. A CSS-hiding implementation passes toBeVisible and fails this.
    await expect(page.getByText('关于动力学的中文正文'), 'zh is not in the DOM').toHaveCount(0);
    await expect(page.getByText('力学についての'), 'ja is not in the DOM').toHaveCount(0);
  });

  test('?lang=zh swaps the prose, and only that language is present', async ({ page }) => {
    await readIn(page, 'zh');
    await expect(page.getByTestId('wiki-landing')).toContainText('关于动力学的中文正文');
    await expect(page.getByText('English prose about'), 'en is gone').toHaveCount(0);
    await expect(page.getByText('力学についての'), 'ja is gone').toHaveCount(0);
  });

  test('a third language works — N is not two', async ({ page }) => {
    await readIn(page, 'ja');
    await expect(page.getByTestId('wiki-landing')).toContainText('力学についての');
    await expect(page.getByText('English prose about')).toHaveCount(0);
  });

  test('prose OUTSIDE the block appears under every language', async ({ page }) => {
    // The one that kills the N-documents model: those sentences belong to no language, and a
    // per-language document would either duplicate them or drop them.
    for (const lang of ['en', 'zh', 'ja']) {
      await readIn(page, lang);
      const body = page.getByTestId('wiki-landing');
      await expect(body, `epigraph under ${lang}`).toContainText('The shared epigraph');
      await expect(body, `between-regions prose under ${lang}`)
        .toContainText('A neutral sentence between the two regions');
    }
  });

  test('the second region switches too — not just the first', async ({ page }) => {
    await readIn(page, 'zh');
    await expect(page.getByTestId('wiki-landing')).toContainText('第二个中文区块');
    await expect(page.getByText('A second English region')).toHaveCount(0);
  });

  test('not one character of the button row survives', async ({ page }) => {
    await readIn(page, '');
    // Neither as a control…
    await expect(page.locator('input[type="radio"][name="x"]')).toHaveCount(0);
    // …nor as text (the pipeline could escape it instead of dropping it).
    await expect(page.getByText('<label>')).toHaveCount(0);
    await expect(page.getByTestId('wiki-landing')).not.toContainText('type="radio"');
  });
});

test.describe('multilingual reader · the switcher', () => {
  test('lists every language, in pane order, and marks the current one',
    async ({ page }) => {
      await readIn(page, '');
      const nav = page.getByTestId('language-switch');
      await expect(nav).toBeVisible();
      // Labels: the built-in native spelling for non-Latin scripts, uppercase otherwise.
      await expect(page.getByTestId('language-en')).toHaveText('EN');
      await expect(page.getByTestId('language-zh')).toHaveText('中文');
      await expect(page.getByTestId('language-ja')).toHaveText('日本語');
    });

  test('clicking one changes the address, so the link can be shared', async ({ page }) => {
    await readIn(page, '');
    await page.getByTestId('language-zh').click();
    await expect(page).toHaveURL(/\?lang=zh$/);
    await expect(page.getByTestId('wiki-landing')).toContainText('关于动力学的中文正文');
  });

  test('a language the note does not have falls back to its identity language, not an error',
    async ({ page }) => {
      await readIn(page, 'de');
      await expect(page.getByTestId('wiki-landing'), 'falls back, no 500')
        .toContainText('English prose about');
    });
});

test.describe('multilingual reader · a note without any of this', () => {
  test('a monolingual note renders exactly as before, with no switcher', async ({ page }) => {
    const plain = await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'Plain', path: 'projects/plain', body: 'Just one language here.',
    });
    await setPublished(O.request, O.csrf, plain.wikiID, true);

    await goto(page, '/wiki/projects/plain');
    await expect(page.getByTestId('wiki-landing')).toContainText('Just one language here');
    await expect(
      page.getByTestId('language-switch'),
      'a switcher with one option is noise',
    ).toHaveCount(0);
  });
});
