// visitor-language-one-choice.spec.ts —— a visitor has one language choice, they can make it on
// any visitor page, and everything that speaks to them follows it: the app's pages, a bilingual
// owner page, the chat widgets, and the agent's answers (owner 2026-10-04: "有时候我看见中文，有时候
// 我看见英文，我都不知道是我设置的还是怎么回事"; "最好还是要给访客界面有调整语言的地方"; "这个语言是
// 要注入给agent的也要注入给sdk"; the switch "是个sdk，看看owner想不想用").
//
// What was wrong (v0.1.123):
//   - A first visit ignored the browser language on app pages (always English) while a bilingual
//     microsite followed it, so a Chinese browser saw a Chinese home page and an English gate.
//   - Only the gate had a language switch; a reader on /wiki or in the chat room could not change.
//   - A bilingual microsite kept its own choice (localStorage sm-lang), the app another (cookie).
//   - The agent was never told the page's language.
// A page WITHOUT the SDK switch stays in its author's language (owner, 2026-09-28: "widget 的
// default 都应该是英文"); the last test holds that line.

import { test, expect } from '@/fixtures/test';
import type { Browser, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { publishPage } from '@/fixtures/microsite-rig';
import { lastGatewayRequest, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession, openGate, openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'onelang@example.com', password: 'correct-horse-battery-staple',
  handle: 'onelang', fullName: 'One Language Owner',
};
const CODE = 'ONELANG-1';
// gate.hero.headline per locale (the gate's big headline; distinct per catalog).
const ZH_HEADLINE = '这里不对外开放';
const BILINGUAL = 'bilingual';
const MONO = 'english-only';
const BILINGUAL_PAGE = `import { LangSwitch, usePageLang } from '@standmeet/sdk';
const TEXT = { en: 'Welcome to my page.', zh: '欢迎来到我的页面。' };
export default function App() {
  const [lang] = usePageLang(['en', 'zh'] as const, 'en');
  return <main data-testid="microsite"><LangSwitch /><h1 data-testid="page-text">{TEXT[lang]}</h1></main>;
}`;
// OWN_TOGGLE_PAGE —— a bilingual page built the way pages were before <LangSwitch>: usePageLang
// and its own buttons. It must keep working exactly as before (owner 2026-10-04: "也要测没有这个
// 组件的时候是不是能fallback老样子").
const OWN_TOGGLE = 'own-toggle';
const OWN_TOGGLE_PAGE = `import { usePageLang } from '@standmeet/sdk';
const TEXT = { en: 'Hello from my own toggle.', zh: '来自我自己的切换。' };
export default function App() {
  const [lang, setLang] = usePageLang(['en', 'zh'] as const, 'en');
  return <main data-testid="microsite">
    <button data-testid="own-en" onClick={() => setLang('en')}>EN</button>
    <button data-testid="own-zh" onClick={() => setLang('zh')}>中文</button>
    <h1 data-testid="page-text">{TEXT[lang]}</h1>
  </main>;
}`;
const MONO_PAGE = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><h1>An English cover letter.</h1><AgentWidget /></main>;
}`;

test.describe('one visitor language, chosen anywhere, followed everywhere', () => {
  test.beforeAll(async ({ playwright }) => {
    // Three microsite builds, one at a time in the sandbox (~40–180 s each on a loaded host).
    test.setTimeout(900_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'one language' });
    await publishPage(request, csrf, BILINGUAL, BILINGUAL_PAGE);
    await publishPage(request, csrf, MONO, MONO_PAGE);
    await publishPage(request, csrf, OWN_TOGGLE, OWN_TOGGLE_PAGE);
    await request.dispose();
  });

  test('without <LangSwitch/>, a page\'s own toggle works as before', ownToggleWorksAsBefore);
  test('a turn sent without page_lang (an older client) is answered, with no language line', oldClientTurn);
  test('a first visit from a Chinese browser opens app pages in Chinese', firstVisitChinese);
  test('the wiki reader carries the switch; the choice holds on the next page', wikiSwitchHolds);
  test('the chat room carries the switch, and the agent is told the page language', roomSwitchTellsAgent);
  test('an owner page with <LangSwitch/> switches in place, and the app follows that choice', ownerSwitchShared);
  test('an owner page without the switch keeps its author\'s language', ownerPageKeepsLanguage);
});

async function ownToggleWorksAsBefore({ browser }: { browser: Browser }): Promise<void> {
    test.setTimeout(120_000);
    // First visit from a Chinese browser: the page follows the browser, as it always did.
    const zhCtx = await browser.newContext({ locale: 'zh-CN' });
    const zhPage = await zhCtx.newPage();
    await openReader(zhPage, `/p/${OWN_TOGGLE}`);
    await expect(zhPage.getByTestId('page-text')).toHaveText('来自我自己的切换。', { timeout: 30_000 });
    await zhCtx.close();
    // An English browser: English, and the page's own button switches it.
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    await openReader(page, `/p/${OWN_TOGGLE}`);
    await expect(page.getByTestId('page-text')).toHaveText('Hello from my own toggle.', { timeout: 30_000 });
    await page.getByTestId('own-zh').click();
    await expect(page.getByTestId('page-text')).toHaveText('来自我自己的切换。');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
    await page.getByTestId('own-en').click();
    await expect(page.getByTestId('page-text')).toHaveText('Hello from my own toggle.');
    await ctx.close();
}

async function oldClientTurn({ playwright }: { playwright: Playwright }): Promise<void> {
    test.setTimeout(120_000);
    const visitor = await playwright.request.newContext();
    const opened = await visitor.post('/api/v1/sessions', { data: { mode: 'code', code: CODE, visitor_name: 'Old' } });
    expect(opened.status()).toBe(200);
    const { session_token: token, conversation_id: conv } = await opened.json() as {
      session_token: string; conversation_id: string;
    };
    const tag = await scriptMockReplyText(visitor, 'Answered without a page language.');
    const res = await visitor.post('/api/v1/agent/turn', {
      headers: { Authorization: `Bearer ${token}` },
      data: { system: 'You are the owner.', user_message: `hi${tag}`, conversation_id: conv, history: [] },
    });
    expect(res.status(), 'an old client\'s turn is still accepted').toBe(200);
    expect(await res.text()).toContain('Answered without a page language.');
    const sent = await lastGatewayRequest(visitor, tag, 'Language of your answer');
    expect(sent.found).toBe(true);
    expect(sent.contains, 'no page language → no language line').toBe(false);
    await visitor.dispose();
}

async function firstVisitChinese({ browser }: { browser: Browser }): Promise<void> {
    const ctx = await browser.newContext({ locale: 'zh-CN' });
    const page = await ctx.newPage();
    await openGate(page, '/gate');
    await expect(page.getByText(ZH_HEADLINE).first()).toBeVisible({ timeout: 15_000 });
    await ctx.close();
}

async function wikiSwitchHolds({ browser }: { browser: Browser }): Promise<void> {
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    await openReader(page, '/wiki');
    await chooseInAppSwitch(page, 'zh');
    await openGate(page, '/gate');
    await expect(page.getByText(ZH_HEADLINE).first(), 'the gate follows the choice').toBeVisible({ timeout: 15_000 });
    await ctx.close();
}

async function roomSwitchTellsAgent({ browser }: { browser: Browser }): Promise<void> {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE);
    await expect(page.getByTestId('locale-switch'), 'the room offers the switch').toBeVisible({ timeout: 20_000 });
    await chooseInAppSwitch(page, 'zh');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
    const tag = await scriptMockReplyText(page.request, '好的。');
    const input = page.getByTestId('chat-input-field');
    await input.fill(`hi${tag}`);
    await input.press('Enter');
    await expect(page.getByTestId('answer-body').last()).toContainText('好的。', { timeout: 60_000 });
    const sent = await lastGatewayRequest(page.request, tag, 'page they are reading, which is Simplified Chinese');
    // (the line the backend adds; the eval page-lang checks the model honours it)
    expect(sent.found, 'the turn reached the model').toBe(true);
    expect(sent.contains, 'the model was told the page language').toBe(true);
    await ctx.close();
}

async function ownerSwitchShared({ browser }: { browser: Browser }): Promise<void> {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    await openReader(page, `/p/${BILINGUAL}`);
    await expect(page.getByTestId('page-text')).toHaveText('Welcome to my page.', { timeout: 30_000 });
    const sw = page.getByTestId('lang-switch');
    await sw.locator('summary').click();
    await sw.getByTestId('lang-opt-zh').click();
    await expect(page.getByTestId('page-text'), 'the page re-renders in place').toHaveText('欢迎来到我的页面。');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
    await openGate(page, '/gate');
    await expect(page.getByText(ZH_HEADLINE).first(), 'one choice, also on app pages').toBeVisible({ timeout: 15_000 });
    await ctx.close();
}

async function ownerPageKeepsLanguage({ browser }: { browser: Browser }): Promise<void> {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ locale: 'zh-CN' });
    const page = await ctx.newPage();
    await openReader(page, '/zh/gate'); // the visitor chose Chinese
    await expect(page.getByText(ZH_HEADLINE).first()).toBeVisible({ timeout: 15_000 });
    await openReader(page, `/p/${MONO}`);
    const widget = page.getByTestId('agent-widget');
    await expect(widget).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html'), 'the page declares its own language').not.toHaveAttribute('lang', 'zh');
    await expect(widget, 'the widget speaks the page\'s language').not.toContainText(/[一-鿿]/);
    await ctx.close();
}

async function chooseInAppSwitch(page: Page, lang: string): Promise<void> {
  const sw = page.getByTestId('locale-switch').first();
  await expect(sw).toBeVisible({ timeout: 20_000 });
  await sw.locator('summary').click();
  await sw.getByTestId(`locale-opt-${lang}`).click();
  await expect(page.locator('html')).toHaveAttribute('lang', lang, { timeout: 15_000 });
}
