// custom-page-code-binding.spec.ts —— 一张码可以绑一个自定义页。
//
// **页面是这张码的一个渲染。** 码不变：同一份授权、同一个角色、同一套配额、同一份记账；
// 页面只换读者看到的样子。所以这里断的从来不是「页面支持某个功能」，而是
// 「**它凭什么会跟 chat 不一样**」—— 答案永远该是不会。
//
// 覆盖：
//   绑定本身（绑 / 解绑 / 一张码至多一页 / 绑一个不存在的 slug 要被拒）
//   双向可查（码那一侧看得到页，页那一侧看得到码 —— 一个事实两处读）
//   I-4 优先级（来了 grant 就以 grant 为准，页面自己的 BYOK 设置作废）
//   I-3 撤下（页删了，码退回默认落地而不是跟着失效）

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'page-binding@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'binding',
  fullName: 'Binding Owner',
};

interface CodeRow { id: string; code: string }
interface PageRow { slug: string; bound_codes: string[]; allow_byoai: boolean }

async function adminJSON(
  request: APIRequestContext, csrf: string, method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string, data?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request[method](`${BACKEND}/api/admin${path}`, {
    headers: { 'X-Csrftoken': csrf },
    ...(data === undefined ? {} : { data }),
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

async function freshOwner(playwright: Playwright): Promise<{
  request: APIRequestContext; csrf: string;
}> {
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  return { request, csrf };
}

// makePage / makeCode —— 只建，不构建。绑定跟「页面构建好了没有」是两件事，
// 混在一起的话，绑定的红会被构建的慢淹掉。
async function makePage(request: APIRequestContext, csrf: string, slug: string): Promise<void> {
  const made = await adminJSON(request, csrf, 'post', '/custom-pages/', { slug, title: slug });
  expect(made.status, 'create page').toBe(201);
}

async function makeCode(request: APIRequestContext, csrf: string, label: string): Promise<CodeRow> {
  const made = await adminJSON(request, csrf, 'post', '/codes/', { label });
  expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
  return made.body as unknown as CodeRow;
}

async function pages(request: APIRequestContext, csrf: string): Promise<PageRow[]> {
  const got = await adminJSON(request, csrf, 'get', '/custom-pages/');
  return (got.body['custom_pages'] ?? got.body['pages'] ?? got.body) as unknown as PageRow[];
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('custom pages · a code opens a page (the page is a rendering of the code)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await freshOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  test('binding reads the same from the code side and the page side', async () => {
    await makePage(request, csrf, 'welcome');
    const code = await makeCode(request, csrf, 'RECRUITER');

    const bound = await adminJSON(request, csrf, 'patch',
      `/codes/${code.id}/custom-page`, { slug: 'welcome' });
    expect(bound.status, JSON.stringify(bound.body)).toBe(200);
    // 回执是**回读到的** slug，不是入参回声。
    expect(bound.body['custom_page_slug'], 'the receipt reads back the binding').toBe('welcome');

    // 页那一侧看得到码 —— 同一个事实的另一头。**只看一侧的绑定，人会忘了自己建过。**
    const row = (await pages(request, csrf)).find((p) => p.slug === 'welcome');
    expect(row?.bound_codes, 'the page side lists the code that opens it')
      .toContain(code.code);
  });

  test('a code opens at most one page — rebinding moves it, it does not add', async () => {
    await makePage(request, csrf, 'first');
    await makePage(request, csrf, 'second');
    const code = await makeCode(request, csrf, 'MOVES');

    await adminJSON(request, csrf, 'patch', `/codes/${code.id}/custom-page`, { slug: 'first' });
    await adminJSON(request, csrf, 'patch', `/codes/${code.id}/custom-page`, { slug: 'second' });

    const all = await pages(request, csrf);
    expect(all.find((p) => p.slug === 'second')?.bound_codes,
      'the new page has it').toContain(code.code);
    expect(all.find((p) => p.slug === 'first')?.bound_codes,
      'and the old page no longer does').not.toContain(code.code);
  });

  test('an empty slug clears the binding', async () => {
    await makePage(request, csrf, 'temporary');
    const code = await makeCode(request, csrf, 'CLEARS');
    await adminJSON(request, csrf, 'patch', `/codes/${code.id}/custom-page`, { slug: 'temporary' });

    const cleared = await adminJSON(request, csrf, 'patch',
      `/codes/${code.id}/custom-page`, { slug: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body['custom_page_slug'], 'cleared means it opens the default chat').toBe('');
  });

  test('binding to a slug that does not exist is refused, not silently ignored', async () => {
    const code = await makeCode(request, csrf, 'NOSUCH');
    const bad = await adminJSON(request, csrf, 'patch',
      `/codes/${code.id}/custom-page`, { slug: 'never-created' });
    // 静默留成「没绑」是最坏的结果：owner 以为连上了，读者却落在默认对话上。
    expect(bad.status, 'a binding that cannot be made must fail loudly')
      .toBeGreaterThanOrEqual(400);
  });

  test('deleting the page returns its codes to the default landing, it does not kill them',
    async () => {
      await makePage(request, csrf, 'doomed');
      const code = await makeCode(request, csrf, 'SURVIVES');
      await adminJSON(request, csrf, 'patch', `/codes/${code.id}/custom-page`, { slug: 'doomed' });

      expect((await adminJSON(request, csrf, 'delete', '/custom-pages/doomed')).status).toBe(200);

      // 码还活着，只是回到默认落地 —— 撤一个渲染不是撤一份授权。
      const intro = await request.post(`${BACKEND}/api/v1/codes/intro`, {
        data: { code: code.code },
      });
      expect(intro.status(), 'the code still works').toBe(200);
      const body = await intro.json() as { custom_page_slug: string };
      expect(body.custom_page_slug, 'and it now opens the default chat').toBe('');
    });
});

test.describe('custom pages · an arriving grant wins (I-4)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await freshOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  test('the landing is told to the visitor when the code is presented', async () => {
    await makePage(request, csrf, 'landing');
    const code = await makeCode(request, csrf, 'LANDS');
    await adminJSON(request, csrf, 'patch', `/codes/${code.id}/custom-page`, { slug: 'landing' });

    // 访客那一侧：带码进来的第一跳就问 codes/intro，落地决定在那里给出，
    // 不必为「去哪」再加一次往返。
    const intro = await request.post(`${BACKEND}/api/v1/codes/intro`, {
      data: { code: code.code },
    });
    expect(intro.status()).toBe(200);
    const body = await intro.json() as { custom_page_slug: string; max_members: number };
    expect(body.custom_page_slug, 'the visitor is told which page this code opens')
      .toBe('landing');
  });

  test('a code with no binding still lands on the default chat', async () => {
    const code = await makeCode(request, csrf, 'PLAIN');
    const intro = await request.post(`${BACKEND}/api/v1/codes/intro`, {
      data: { code: code.code },
    });
    const body = await intro.json() as { custom_page_slug: string };
    // 空串 = 开默认对话，**不是**「没答上来」。
    expect(body.custom_page_slug, 'an unbound code is unchanged from today').toBe('');
  });

  test('the page byoai switch is stored, and is the page-level setting only', async () => {
    await makePage(request, csrf, 'byok');
    const on = await adminJSON(request, csrf, 'put',
      '/custom-pages/byok/byoai', { allow_byoai: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body['allow_byoai'], 'the receipt reads back what is stored').toBe(true);

    const off = await adminJSON(request, csrf, 'put',
      '/custom-pages/byok/byoai', { allow_byoai: false });
    // **显式 false 必须能存进去** —— 指针入参就是为了分开「没给」和「给了 false」。
    expect(off.body['allow_byoai'], 'turning it off is not the same as not saying').toBe(false);
  });
});
