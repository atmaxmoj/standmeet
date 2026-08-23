// custom-page-admin-authoring.spec.ts —— 自定义页的写作在**面板**上也走得通，
// 而且失败的时候说得出话。
//
// 为什么这个文件存在：写这一组曾经只在 MCP 上，例外的理由是
// `fp.Only("…the panel has no such surface", "mcp")` —— 用现状解释现状，而且写在棘轮
// 读得到的地方，于是缺口从此不再被报。删掉例外之后收口在启动时点名要这八条。
//
// **这里的重点是失败路径。** 原有覆盖是三条，全是 happy path：建完能看见、没有死按钮、
// staging→live→delete。九个 op 一条失败用例都没有（[[all-tests-are-failure-path]] 的反面）。
// 而对 owner 来说，「构建悄悄失败、线上还是旧页」跟「构建成功了」在屏幕上长得一模一样。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'page-authoring@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'authoring',
  fullName: 'Page Authoring Owner',
};

const MARKER = 'ADMIN_AUTHORED_PAGE';

// GOOD —— 编译得过的最小页面。
const GOOD_APP = `
export default function App() {
  return <main><h1>${MARKER}</h1></main>;
}
`.trim();

// BAD —— **编译不过**。缺一个右花括号，vite 一定失败。
// 判据要的是「owner 被告知哪里坏了」，所以坏在源码里，不是坏在参数上。
const BAD_APP = `
export default function App() {
  return <main><h1>never built</h1></main>;
`.trim();

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

interface BuildRow { build_id?: string; status?: string; error_message?: string }

// api —— 面板那条路（admin HTTP），**不是 MCP**。这个文件整篇只走它。
async function api(
  request: APIRequestContext, csrf: string, method: 'get' | 'post' | 'put' | 'delete',
  path: string, data?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request[method](`${BACKEND}/api/admin/custom-pages${path}`, {
    headers: { 'X-Csrftoken': csrf },
    ...(data === undefined ? {} : { data }),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status(), body };
}

// buildUntilSettled —— 轮询到 built | failed。构建是异步的（沙箱起 vite），
// 所以判据必须等到终态，否则断的是"还在 pending"，那对任何实现都成立。
async function buildUntilSettled(
  request: APIRequestContext, csrf: string, slug: string,
): Promise<BuildRow> {
  const started = await api(request, csrf, 'post', `/${slug}/build`);
  expect(started.status, 'the panel can start a build').toBe(200);
  const id = started.body['build_id'] as string;
  expect(id, 'and it hands back the build id to poll').toBeTruthy();
  let row: BuildRow = {};
  await expect.poll(async () => {
    const got = await api(request, csrf, 'get', `/builds/${id}`);
    row = got.body;
    return row.status ?? 'pending';
    // 180s 不是「等久一点碰运气」：沙箱**一次只建一个**，而这一族里好几条用例都要真构建，
    // 于是它们在同一个 builder 上排队。单跑这条 9.5 秒就到终态，整族一起跑就会排在别人后面。
    // 预算给的是**排队**，不是给一次可能永远不来的构建。
  }, { timeout: 180_000, message: 'the build never reached a terminal state' })
    .toMatch(/^(built|failed)$/);
  return row;
}

// liveAt —— 建一个页面并上线，返回访客那一侧的响应。撤下类用例的公共前置：
// 「撤之前它确实在服务」这一句必须真断过，否则撤完的 404 可能一直都是 404。
async function liveAt(
  request: APIRequestContext, csrf: string, slug: string,
) {
  await api(request, csrf, 'post', '/', { slug, title: slug });
  await api(request, csrf, 'put', `/${slug}/files`, { path: 'App.tsx', content: GOOD_APP });
  const built = await buildUntilSettled(request, csrf, slug);
  expect(built.status, built.error_message ?? '').toBe('built');
  await api(request, csrf, 'post', `/${slug}/live`, { build_id: built.build_id });
  return request.get(`${BACKEND}/api/v1/custom-pages/${slug}`);
}

// freshOwner —— 每条用例一个干净实例 + 登录好的 admin 请求上下文。两个 describe 共用。
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

test.describe('custom pages · authoring from the panel (parity with MCP)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await freshOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  test('the whole lifecycle runs on the panel, and the visitor gets the page', async () => {
    expect((await api(request, csrf, 'post', '/', { slug: 'from-panel', title: 'From Panel' }))
      .status, 'create').toBe(201);
    expect((await api(request, csrf, 'put', '/from-panel/files',
      { path: 'App.tsx', content: GOOD_APP })).status, 'write_file').toBe(200);

    const built = await buildUntilSettled(request, csrf, 'from-panel');
    expect(built.status, built.error_message ?? '').toBe('built');

    expect((await api(request, csrf, 'post', '/from-panel/live',
      { build_id: built.build_id })).status, 'promote_to_live').toBe(200);

    // 访客那一侧才是判据 —— 面板说成功不算数。
    const seen = await request.get(`${BACKEND}/api/v1/custom-pages/from-panel`);
    expect(seen.status()).toBe(200);
    expect(await seen.text()).toContain('<div id="root">');
  });

  test('a build that cannot compile fails loudly and leaves the live page alone', async () => {
    // 先上一个能用的版本，好证明"失败不会动线上"。
    await api(request, csrf, 'post', '/', { slug: 'broken', title: 'Broken' });
    await api(request, csrf, 'put', '/broken/files', { path: 'App.tsx', content: GOOD_APP });
    const good = await buildUntilSettled(request, csrf, 'broken');
    expect(good.status).toBe('built');
    await api(request, csrf, 'post', '/broken/live', { build_id: good.build_id });

    // 再推一版编译不过的。
    await api(request, csrf, 'put', '/broken/files', { path: 'App.tsx', content: BAD_APP });
    const bad = await buildUntilSettled(request, csrf, 'broken');

    expect(bad.status, 'a build that cannot compile must not report built').toBe('failed');
    // **不断"有 error_message"** —— 空串也叫有。断它说得出点什么，
    // 否则 owner 拿到的是一个没有原因的失败（[[collapsed-error-class-kills-its-own-branch]]）。
    expect((bad.error_message ?? '').length,
      'and it must say something the owner can act on').toBeGreaterThan(10);

    // 线上仍是上一版：失败不许把已经在服务的东西弄没。
    const still = await request.get(`${BACKEND}/api/v1/custom-pages/broken`);
    expect(still.status(), 'a failed build must not take the live page down').toBe(200);
  });

  test('a build that is not built cannot be promoted', async () => {
    await api(request, csrf, 'post', '/', { slug: 'unbuilt', title: 'Unbuilt' });
    await api(request, csrf, 'put', '/unbuilt/files', { path: 'App.tsx', content: BAD_APP });
    const failed = await buildUntilSettled(request, csrf, 'unbuilt');
    expect(failed.status).toBe('failed');

    const promoted = await api(request, csrf, 'post', '/unbuilt/live',
      { build_id: failed.build_id });
    expect(promoted.status, 'promoting a failed build must be refused').toBeGreaterThanOrEqual(400);
    const gone = await request.get(`${BACKEND}/api/v1/custom-pages/unbuilt`);
    expect(gone.status(), 'and nothing becomes reachable').toBeGreaterThanOrEqual(400);
  });

  test('a slug that already exists is refused', async () => {
    expect((await api(request, csrf, 'post', '/', { slug: 'twice', title: 'One' })).status).toBe(201);
    const again = await api(request, csrf, 'post', '/', { slug: 'twice', title: 'Two' });
    expect(again.status, 'the second create on the same slug is refused')
      .toBeGreaterThanOrEqual(400);
  });
});

// I-3：撤下就是撤下。以下三条各撤一种方式，判据都在**访客那一侧**。
// 单独一个 describe —— 上面那个回调到了 70 行的闸。
test.describe('custom pages · withdrawal is not a snapshot (I-3)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await freshOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  test('rollback takes the page down for the visitor', async () => {
    const live = await liveAt(request, csrf, 'rolled');
    expect(live.status(), 'it is serving before the rollback').toBe(200);

    expect((await api(request, csrf, 'post', '/rolled/rollback')).status).toBe(200);

    const after = await request.get(`${BACKEND}/api/v1/custom-pages/rolled`);
    expect(after.status(), 'after a rollback the visitor URL stops serving')
      .toBeGreaterThanOrEqual(400);
  });

  test('deleting a live page takes it down for the visitor', async () => {
    expect((await liveAt(request, csrf, 'deleted')).status()).toBe(200);
    expect((await api(request, csrf, 'delete', '/deleted')).status).toBe(200);

    const after = await request.get(`${BACKEND}/api/v1/custom-pages/deleted`);
    expect(after.status(), 'a deleted page stops serving').toBeGreaterThanOrEqual(400);
  });

  test('the page is never handed to the browser as cacheable', async () => {
    const live = await liveAt(request, csrf, 'nocache');
    // 撤下之后还能打开，如果是我们让浏览器存的，那就是我们的问题不是浏览器的。
    // 这一路以前**一个 Cache-Control 都没发** —— 没有头，浏览器按启发式自己缓存。
    expect(live.headers()['cache-control'] ?? '',
      'a withdrawable page must not be advertised as cacheable').toMatch(/no-store|no-cache/);
  });
});
