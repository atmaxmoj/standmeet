// agent-widget-i18n.spec.ts —— the embedded widget speaks the PAGE's language, English by
// default, and says what the page tells it to say.
//
// History: the SDK's UI copy used to be hardcoded English with no catalog (2026-09-25), so a
// catalog went in and the language followed the visitor's browser. Owner, 2026-09-28, looking
// at an English cover-letter page on a Chinese browser that showed "想问什么都可以… / 提问":
// "widget 的 default 都应该是英文". A page is written in one language by its author; the widget
// belongs to the page, not to the reader's browser. So:
//   • no language given → English, whatever the browser says;
//   • `lang` given (the same prop CorpusWidget takes) → that language;
//   • `placeholder` / `examples` given → shown as given, in every mode — the inline agent used to
//     drop them, so on an instance with a public tier the author's own copy never appeared.
//
// Blackbox: one built page holding three widgets. First with the public tier spent (the widget
// opens in BYOK mode, which shows the most copy at once), then with the tier refilled (inline mode).

import { test, expect } from '@/fixtures/test';
import type { Browser, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';
import { publishPage } from '@/fixtures/microsite-rig';
import { createProvider } from '@/fixtures/providers';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'widgeti18n@example.com', password: 'correct-horse-battery-staple',
  handle: 'widgeti18n', fullName: 'Widget I18n Owner',
};
const SLUG = 'ask-i18n';
const PLACEHOLDER = 'Ask about my work — answered from my notes…';
const EXAMPLE = 'How do you test what you ship?';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite">
    <section data-testid="w-default"><AgentWidget /></section>
    <section data-testid="w-zh"><AgentWidget lang="zh" /></section>
    <section data-testid="w-custom"><AgentWidget placeholder=${JSON.stringify(PLACEHOLDER)} examples={[${JSON.stringify(EXAMPLE)}]} /></section>
  </main>;
}`;
const CJK = /[一-鿿]/;

let providerID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe.serial('AgentWidget · the page\'s language, English by default', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(600_000); // one microsite build (slow on a loaded dev host)
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    providerID = pub.id;
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    // Spent tank → BYOK mode: the ask box, the BYOK panel and its button are all on screen.
    execSQL(`UPDATE owner_providers SET gas_tokens=0, gas_filled_at=now() WHERE id='${pub.id}'`);
    await publishPage(request, csrf, SLUG, APP, 400_000);
    await request.dispose();
  });

  test('a Chinese browser on a page that names no language sees English', async ({ browser }) => {
    const page = await openAs(browser, 'zh-CN', 'byok');
    const w = page.getByTestId('w-default');
    await expect(w.getByTestId('agent-widget-byok'), 'the BYOK panel').toContainText(/key/i);
    await page.context().close();
  });

  test('an English browser on a widget told lang="zh" sees Chinese', async ({ browser }) => {
    const page = await openAs(browser, 'en-US', 'byok');
    const w = page.getByTestId('w-zh');
    await expect(w.getByTestId('agent-widget-byok'), 'the BYOK panel').toContainText(CJK);
    await expect(w.getByTestId('agent-widget-byok-submit'), 'its button').toContainText(CJK);
    await page.context().close();
  });

  test('inline mode shows the author\'s placeholder and examples', async ({ browser }) => {
    // Refill the public tier: the widget now answers codeless visitors inline.
    execSQL(`UPDATE owner_providers SET gas_tokens=NULL WHERE id='${providerID}'`);
    const page = await openAs(browser, 'zh-CN', 'inline');
    const w = page.getByTestId('w-custom');
    await expect(w.getByTestId('chat-input-field'), 'the author\'s placeholder')
      .toHaveAttribute('placeholder', PLACEHOLDER);
    await expect(w, 'the author\'s example question').toContainText(EXAMPLE);
    await page.context().close();
  });

  // The ask box is only on screen once the visitor can ask (in BYOK mode it waits for the key),
  // so its own copy is checked in inline mode.
  test('inline mode: the ask box speaks the page\'s language, not the browser\'s', async ({ browser }) => {
    const page = await openAs(browser, 'zh-CN', 'inline');
    await expect(page.getByTestId('w-default').getByTestId('chat-input-field'), 'no lang → English')
      .toHaveAttribute('placeholder', /^[^一-鿿]*[A-Za-z]{3}[^一-鿿]*$/);
    await expect(page.getByTestId('w-zh').getByTestId('chat-input-field'), 'lang="zh" → Chinese')
      .toHaveAttribute('placeholder', CJK);
    await page.context().close();
  });
});

async function openAs(browser: Browser, locale: string, mode: 'byok' | 'inline'): Promise<Page> {
  const page = await (await browser.newContext({ locale })).newPage();
  await openReader(page, `/p/${SLUG}`);
  await expect(page.getByTestId('w-default').getByTestId('agent-widget'))
    .toHaveAttribute('data-mode', mode, { timeout: 20_000 });
  return page;
}
