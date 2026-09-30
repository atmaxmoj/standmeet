// microsite-zh-visitor-chat.spec.ts —— a visitor whose page language is Chinese can chat on a
// prerendered microsite, and sees it when a turn fails.
//
// What happened on sijie.xyz (v0.1.79, /p/standmeet, browser in Chinese): the console reported React
// #418 (hydration mismatch — the prerender is English, the page's first client render already
// Chinese). Then a question sent from the page's AgentWidget showed nothing: no question line, no
// progress, no error — even for a turn the server answered 503. The page's language hook read
// localStorage / navigator in its first render, the pattern every owner microsite was written with.
//
// Measured (this spec, first version): the naive hook reproduces #418, yet the widget still answered
// and still showed a failed turn's error — so the silent widget on prod was not the error display.
//
// The fix is the SDK's hydration-safe page hooks: usePageLang / usePageTheme render the prerender's
// default first and apply the visitor's stored choice right after mount. (A theme read in the first
// render is worse than a warning: React keeps the server's attribute, so a dark-mode visitor stays
// on the light theme.) This spec publishes a page written with them and drives it as a visitor whose
// stored language is Chinese and theme dark. Contract:
//   • hydration raises no error (no React #418);
//   • the page switches to the stored language and theme after mount;
//   • a question shows its answer; a failed turn shows a readable error in the widget (inside the
//     turn's answer, marked with data-error-code).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
import { createProvider } from '@/fixtures/providers';
import { openReader } from '@/fixtures/navigate';
import { scriptMockError, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { publishPage } from '@/fixtures/microsite-rig';

const OWNER = {
  email: 'zhchat@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'zhchat',
  fullName: 'Zh Chat Owner',
};
const SLUG = 'zh-chat';

const SOURCE = `
import { StandMeetProvider, AgentWidget, usePageLang, usePageTheme } from "@standmeet/sdk";

export default function App() {
  const [lang] = usePageLang(["en", "zh"] as const, "en");
  const theme = usePageTheme();
  return (
    <StandMeetProvider>
      <main data-testid="page" data-theme={theme}>
        <h1>{lang === "zh" ? "灯塔笔记" : "Lighthouse notes"}</h1>
        <AgentWidget placeholder={lang === "zh" ? "问点什么" : "Ask something"} />
      </main>
    </StandMeetProvider>
  );
}
`;

async function openAsZhVisitor(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    window.localStorage.setItem('sm-lang', 'zh');
    window.localStorage.setItem('standmeet-dark', '1');
  });
  await openReader(page, `/p/${SLUG}`);
  await expect(page.getByRole('heading', { name: '灯塔笔记' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('page')).toHaveAttribute('data-theme', 'dark');
  return errors;
}

async function ask(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('agent-widget').getByTestId('chat-input-field');
  await expect(input).toBeEnabled({ timeout: 20_000 });
  await input.fill(text);
  await input.press('Enter');
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.describe('microsite · a Chinese-language visitor chats on a prerendered page', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // The public tier answers codeless visitors (as on sijie.xyz): a public provider, and the
    // `public` role pointed at it, so the AgentWidget chats inline.
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: 'http://llm-gateway:9300',
      model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    await publishPage(request, csrf, SLUG, SOURCE);
    await request.dispose();
  });

  test('hydration is clean and a question shows its answer', async ({ browser, playwright }) => {
    const request = await playwright.request.newContext();
    const tag = await scriptMockReplyText(request, '灯塔一共有九十七级台阶。');
    const page = await (await browser.newContext()).newPage();
    const errors = await openAsZhVisitor(page);
    await ask(page, `灯塔有多少级台阶？ ${tag}`);
    await expect(page.getByTestId('agent-widget').getByTestId('answer-body').last())
      .toContainText('九十七级台阶', { timeout: 30_000 });
    // The page switched itself to Chinese, so the chat's own words are Chinese too (it follows the
    // language the page declares).
    await expect(page.getByTestId('agent-widget').getByText('你', { exact: true })).toBeVisible();
    expect(errors.filter((e) => /#418|hydrat/i.test(e)), 'no hydration mismatch').toEqual([]);
    await page.context().close();
    await request.dispose();
  });

  test('a failed turn shows an error line in the widget', async ({ browser, playwright }) => {
    const request = await playwright.request.newContext();
    const tag = await scriptMockError(request);
    const page = await (await browser.newContext()).newPage();
    await openAsZhVisitor(page);
    await ask(page, `会失败的问题 ${tag}`);
    // The error is said inside the turn's answer, marked with the server's error code.
    const answer = page.getByTestId('agent-widget').getByTestId('answer-body').last();
    await expect(answer, 'the turn ended in an error').toHaveAttribute('data-error-code', /.+/, { timeout: 60_000 });
    await expect(answer).not.toHaveText('');
    await page.context().close();
    await request.dispose();
  });
});
