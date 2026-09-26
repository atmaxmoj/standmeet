// agent-widget-i18n.spec.ts —— the embedded widgets speak the visitor's language. The SDK's UI
// copy used to be hardcoded English (no catalog, no lint), so a Chinese reader on a microsite got
// "Ask anything…" and an English BYOK panel (owner, 2026-09-25: "你这里怎么写明文啊？").
//
// Blackbox: one page (public quota spent → the widget opens in BYOK mode, which shows the most
// copy at once), read by an English browser and by a Chinese browser. Each sees its own language
// in the ask box, the BYOK panel and its button. The language comes from the visitor (browser
// language, or the page's stored `sm-lang` choice), the same rule CorpusWidget already used.

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
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget /></main>;
}`;
const CJK = /[一-鿿]/;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('AgentWidget · speaks the visitor language', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(600_000); // one microsite build (slow on a loaded dev host)
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    // Spent tank → BYOK mode: the ask box, the BYOK panel and its button are all on screen.
    execSQL(`UPDATE owner_providers SET gas_tokens=0, gas_filled_at=now() WHERE id='${pub.id}'`);
    await publishPage(request, csrf, SLUG, APP, 400_000);
    await request.dispose();
  });

  test('an English browser sees English copy', async ({ browser }) => {
    const page = await openAs(browser, 'en-US');
    await expect(page.getByTestId('agent-widget-input')).toHaveAttribute('placeholder', /[A-Za-z]{3}/);
    await expect(page.getByTestId('agent-widget-byok')).toContainText(/key/i);
    await page.context().close();
  });

  test('a Chinese browser sees Chinese copy — ask box, BYOK panel, its button', async ({ browser }) => {
    const page = await openAs(browser, 'zh-CN');
    await expect(page.getByTestId('agent-widget-input'), 'the ask box').toHaveAttribute('placeholder', CJK);
    await expect(page.getByTestId('agent-widget-byok'), 'the BYOK panel').toContainText(CJK);
    await expect(page.getByTestId('agent-widget-byok-submit'), 'its button').toContainText(CJK);
    await page.context().close();
  });
});

async function openAs(browser: Browser, locale: string): Promise<Page> {
  const page = await (await browser.newContext({ locale })).newPage();
  await openReader(page, `/p/${SLUG}`);
  await expect(page.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'byok', { timeout: 20_000 });
  return page;
}
