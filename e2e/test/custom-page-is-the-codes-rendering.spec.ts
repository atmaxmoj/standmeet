// custom-page-is-the-codes-rendering.spec.ts —— **pages 给了 code 一个渲染**。
//
// 一张码可以绑一个自定义页。绑了之后，码一点没变：同一份授权、同一个角色、同一套配额、
// 同一份记账 —— 变的只有读者眼前那张纸。所以这一篇断的从来不是「页面支持某个功能」，
// 而是「**它凭什么会跟 chat 不一样**」，而答案永远该是不会。
//
// 判据全在**页面上**。后端对、而页面自己另开了一场匿名 session，从屏幕上看不出差别：
// 名字、名额、轮数全部落空，读者却一直在正常问答（[[test-covers-capability-not-face]]）。
//
// 覆盖：落地（扫出来看到的就是那一页）· 记账（对话进那张码）· 继承（名字/名额/轮数/撤销）
// · 准入（带了码就不再问自带 key）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login } from '@/fixtures/admin';
import { createCode, revokeCode } from '@/fixtures/codes';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { initMCP } from '@/fixtures/mcp';
import { bindCodeToPage, publishPage, setPageByoai } from '@/fixtures/custom-page-rig';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'page-rendering@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'rendering',
  fullName: 'Rendering Owner',
};

interface Admin { request: APIRequestContext; csrf: string }

// 每条用例都要真构建一次页面（沙箱起 vite，**一次只建一个**，这一族里好几条在排队），
// 所以 30s 的默认预算不够。放宽的是**排队**，不是给一次可能永远不来的构建：
// 轮询自己仍然在 180s 上有终点，超时依旧是红。
const BUILD_BUDGET_MS = 240_000;

async function freshOwner(playwright: Playwright): Promise<Admin> {
  test.setTimeout(BUILD_BUDGET_MS);
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

// enterWithCode —— 带码进站 → 名字选择器填名字 → 提交。**不指定去哪**：
// 落地是产品自己的决定，这个 helper 只负责走完领码这一段。
async function enterWithCode(page: Page, code: string, name: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const issued = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 20_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
  await issued;
}

// askOnPage —— 在页面的问答栏问一句，等答案出现。
async function askOnPage(page: Page, text: string): Promise<void> {
  const box = page.locator('[data-sm="ask"]');
  await box.waitFor({ state: 'visible', timeout: 20_000 });
  await box.fill(text);
  await box.press('Enter');
}

const sm = (page: Page, name: string) => page.locator(`[data-sm="${name}"]`);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('a bound code opens its page, and the page is that code', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('a code bound to a page lands the visitor on the page, not the default chat',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'landing');
      const code = await createCode(admin.request, admin.csrf,
        { code: 'LAND-001', label: 'LANDS' });
      await bindCodeToPage(admin.request, admin.csrf, code.id, 'landing');

      await enterWithCode(page, 'LAND-001', 'Reader');

      // **扫出来看到的就该是那一页。** 停在默认对话上，owner 建的那个渲染等于没建 ——
      // 而屏幕上看起来一切正常。
      await expect(sm(page, 'marker')).toBeVisible({ timeout: 20_000 });
      expect(new URL(page.url()).pathname, 'the visitor is on the page this code opens')
        .toBe('/p/landing');
    });

  test('an unbound code still lands on the default chat', async ({ page }) => {
    await publishPage(admin.request, admin.csrf, 'unused');
    await createCode(admin.request, admin.csrf, { code: 'PLAIN-01', label: 'PLAIN' });

    await enterWithCode(page, 'PLAIN-01', 'Reader');

    // 没绑的码一点没变 —— 一个新机制不许顺手改掉今天已经在用的那条路。
    expect(new URL(page.url()).pathname, 'a code with no page is unchanged from today')
      .toBe('/');
  });

  test('the page answers on the code’s session, and the turn shows up under that code',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'ledger');
      const code = await createCode(admin.request, admin.csrf,
        { code: 'LEDG-001', label: 'LEDGER' });
      await bindCodeToPage(admin.request, admin.csrf, code.id, 'ledger');

      await enterWithCode(page, 'LEDG-001', 'Ledger Reader');
      await expect(sm(page, 'grant'), 'the page knows this reader arrived on a code')
        .toHaveText('on a code', { timeout: 20_000 });

      const tag = await scriptMockReplyText(admin.request, 'answered from the corpus');
      await askOnPage(page, `what is here ${tag}`);
      await expect(sm(page, 'answer')).toContainText('answered from the corpus',
        { timeout: 30_000 });

      // owner 那一侧：这一轮必须记在**这张码**下面。记不上的话，owner 得靠猜
      // 一段逐字稿是从哪个界面来的。
      const convos = await admin.request.get(
        `${process.env['BACKEND_URL'] ?? 'http://localhost:8000'}/api/admin/conversations`,
        { headers: { 'X-Csrftoken': admin.csrf } },
      );
      expect(convos.status()).toBe(200);
      expect(JSON.stringify(await convos.json()),
        'the page’s turn is on the code’s ledger, not on a session of its own')
        .toContain('Ledger Reader');
    });
});

test.describe('a page cannot show what the viewer cannot read', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('a published entry opens on the page, a private one does not', async ({ page }) => {
    await publishPage(admin.request, admin.csrf, 'scoped');
    const token = await createAPIToken(admin.request, admin.csrf, 'page-scope');
    const sid = await initMCP(admin.request, token);

    const open = await seedWiki(admin.request, token, sid,
      { title: 'Open Note', body: 'anyone may read this', path: 'open-note' });
    await publishEntry(admin.request, token, sid, { genre: 'wiki', id: open.wikiID });
    await seedWiki(admin.request, token, sid,
      { title: 'Private Note', body: 'nobody may read this', path: 'private-note' });

    // 正对照先跑。少了它，下面那条「打不开」可能只是因为这一页的读法根本没做出来
    // （[[assertion-that-cannot-fail]]）。
    await goto(page, '/p/scoped?read=open-note');
    await expect(sm(page, 'note-state')).toHaveText('open', { timeout: 20_000 });
    await expect(sm(page, 'note')).toHaveText('Open Note');

    // 判据在**页面上**：后端拒了、而页面照样把标题印出来（缓存/多取），
    // 正是这条检查存在的理由。
    await goto(page, '/p/scoped?read=private-note');
    await expect(sm(page, 'note-state'),
      'an unpublished entry does not open for an anonymous reader')
      .toHaveText('denied', { timeout: 20_000 });
    await expect(sm(page, 'note')).toHaveText('');
  });
});

test.describe('everything the code carries, carries onto the page', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('the turn allowance is the code’s allowance', async ({ page }) => {
    await publishPage(admin.request, admin.csrf, 'metered');
    const code = await createCode(admin.request, admin.csrf,
      { code: 'METR-001', label: 'METERED', max_turns_per_session: 1 });
    await bindCodeToPage(admin.request, admin.csrf, code.id, 'metered');

    await enterWithCode(page, 'METR-001', 'Metered Reader');
    const first = await scriptMockReplyText(admin.request, 'the one turn you get');
    await askOnPage(page, `first ${first}`);
    await expect(sm(page, 'answer')).toContainText('the one turn you get', { timeout: 30_000 });

    // 第二轮必须被同一套配额挡下。**断的是页面说了话**，不是「没答出来」——
    // 一个静默失败的页面跟一个还在想的页面长得一样。
    const second = await scriptMockReplyText(admin.request, 'this must never render');
    await askOnPage(page, `second ${second}`);
    await expect(sm(page, 'error'), 'the page says the allowance ran out')
      .not.toHaveText('', { timeout: 30_000 });
    await expect(sm(page, 'answer'), 'and no second answer arrives')
      .not.toContainText('this must never render');
  });

  test('the name allowance is the code’s allowance', async ({ browser, page }) => {
    await publishPage(admin.request, admin.csrf, 'named');
    const code = await createCode(admin.request, admin.csrf,
      { code: 'NAME-001', label: 'NAMES', max_members: 1 });
    await bindCodeToPage(admin.request, admin.csrf, code.id, 'named');

    await enterWithCode(page, 'NAME-001', 'First Reader');
    await expect(sm(page, 'marker')).toBeVisible({ timeout: 20_000 });

    // 第二个人从一张干净的浏览器上下文进来 —— 名额是这张码的属性，不是这台机器的。
    const other = await browser.newContext();
    const second = await other.newPage();
    await goto(second, '/?code=NAME-001');
    await second.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 20_000 });
    await second.getByTestId('visitor-name-input').fill('Second Reader');
    await second.getByTestId('visitor-name-submit').click();

    // 名额满了要在**进门那一刻**被挡住，而且说得出为什么 —— 挂了页也不该换一种说法。
    await expect(second.getByTestId('visitor-name-input'),
      'a code with one name left does not admit a second reader')
      .toBeVisible({ timeout: 20_000 });
    expect(new URL(second.url()).pathname, 'and the second reader never reaches the page')
      .not.toBe('/p/named');
    await other.close();
  });

  test('revoking the code stops the page’s agent', async ({ page }) => {
    await publishPage(admin.request, admin.csrf, 'revoked');
    const code = await createCode(admin.request, admin.csrf,
      { code: 'REVK-001', label: 'REVOKED' });
    await bindCodeToPage(admin.request, admin.csrf, code.id, 'revoked');

    await enterWithCode(page, 'REVK-001', 'Revoked Reader');
    const ok = await scriptMockReplyText(admin.request, 'still allowed');
    await askOnPage(page, `before ${ok}`);
    await expect(sm(page, 'answer')).toContainText('still allowed', { timeout: 30_000 });

    // owner 收回授权 —— 页面这一侧必须立刻停。**没有访问快照**。
    await revokeCode(admin.request, admin.csrf, code.id);

    const after = await scriptMockReplyText(admin.request, 'must not answer after revoke');
    await askOnPage(page, `after ${after}`);
    await expect(sm(page, 'error'), 'a revoked code stops the page’s agent')
      .not.toHaveText('', { timeout: 30_000 });
    await expect(sm(page, 'answer'))
      .not.toContainText('must not answer after revoke');
  });
});

test.describe('an arriving grant wins over the page’s own setting (I-4)', () => {
  let admin: Admin;

  test.beforeEach(async ({ playwright }) => { admin = await freshOwner(playwright); });
  test.afterEach(async () => { await admin.request.dispose(); });

  test('a page that allows BYOK still offers it when nobody presents a code',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'byok-on');
      await setPageByoai(admin.request, admin.csrf, 'byok-on', true);

      await goto(page, '/p/byok-on');
      // 正对照。少了它，下一条的「没提供」可能是因为这条路根本没做出来
      // （[[assertion-that-cannot-fail]]）。
      await expect(sm(page, 'byok'), 'with no grant, the page’s own setting applies')
        .toBeVisible({ timeout: 20_000 });
    });

  test('the same page does not offer BYOK to a reader who arrived on a code',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'byok-void');
      await setPageByoai(admin.request, admin.csrf, 'byok-void', true);
      const code = await createCode(admin.request, admin.csrf,
        { code: 'BYOK-001', label: 'BYOK' });
      await bindCodeToPage(admin.request, admin.csrf, code.id, 'byok-void');

      await enterWithCode(page, 'BYOK-001', 'Granted Reader');
      await expect(sm(page, 'marker')).toBeVisible({ timeout: 20_000 });

      // 手里那份授权是 owner 给的，比自带 key 大。再问一次「要不要用你自己的 key」，
      // 等于把 owner 的决定交回给读者。
      await expect(sm(page, 'byok'),
        'a reader who arrived on a code is not asked to bring a key')
        .toHaveCount(0);
    });

  test('turning BYOK off takes the offer away on the next load, with no snapshot',
    async ({ page }) => {
      await publishPage(admin.request, admin.csrf, 'byok-off');
      await setPageByoai(admin.request, admin.csrf, 'byok-off', true);
      await goto(page, '/p/byok-off');
      await expect(sm(page, 'byok')).toBeVisible({ timeout: 20_000 });

      await setPageByoai(admin.request, admin.csrf, 'byok-off', false);
      await goto(page, '/p/byok-off');
      await expect(sm(page, 'marker')).toBeVisible({ timeout: 20_000 });
      await expect(sm(page, 'byok'), 'the withdrawn setting takes effect on the next request')
        .toHaveCount(0);
    });
});
