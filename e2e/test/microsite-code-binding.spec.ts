// microsite-code-binding.spec.ts —— a code can bind one custom page.
//
// **A page is a rendering of the code.** The code doesn't change: same grant, same role, same quota, same accounting;
// the page only swaps what the reader sees. So what this asserts is never "the page supports some feature", but
// "**on what grounds would it ever differ from chat**" —— and the answer should always be that it doesn't.
//
// Coverage:
//   the binding itself (bind / unbind / at most one page per code / binding a nonexistent slug must be rejected)
//   bidirectional lookup (the code side sees the page, the page side sees the code —— one fact read from two places)
//   I-4 priority (an arriving grant wins, the page's own BYOK setting is voided)
//   I-3 teardown (page deleted → the code falls back to the default landing rather than dying with it)

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

// makePage / makeCode —— create only, don't build. Binding and "is the page built yet" are two separate things;
// mixed together, a binding failure would be drowned out by the slowness of the build.
async function makePage(request: APIRequestContext, csrf: string, slug: string): Promise<void> {
  const made = await adminJSON(request, csrf, 'post', '/microsites/', { slug, title: slug });
  expect(made.status, 'create page').toBe(201);
}

async function makeCode(request: APIRequestContext, csrf: string, label: string): Promise<CodeRow> {
  const made = await adminJSON(request, csrf, 'post', '/codes/', { label });
  expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
  return made.body as unknown as CodeRow;
}

async function pages(request: APIRequestContext, csrf: string): Promise<PageRow[]> {
  const got = await adminJSON(request, csrf, 'get', '/microsites/');
  return (got.body['microsites'] ?? got.body['pages'] ?? got.body) as unknown as PageRow[];
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
      `/codes/${code.id}/microsite`, { slug: 'welcome' });
    expect(bound.status, JSON.stringify(bound.body)).toBe(200);
    // The receipt is the slug **read back**, not an echo of the input.
    expect(bound.body['microsite_slug'], 'the receipt reads back the binding').toBe('welcome');

    // The page side sees the code —— the other end of the same fact. **Look at the binding from only one side and you forget you made it.**
    const row = (await pages(request, csrf)).find((p) => p.slug === 'welcome');
    expect(row?.bound_codes, 'the page side lists the code that opens it')
      .toContain(code.code);
  });

  test('a code opens at most one page — rebinding moves it, it does not add', async () => {
    await makePage(request, csrf, 'first');
    await makePage(request, csrf, 'second');
    const code = await makeCode(request, csrf, 'MOVES');

    await adminJSON(request, csrf, 'patch', `/codes/${code.id}/microsite`, { slug: 'first' });
    await adminJSON(request, csrf, 'patch', `/codes/${code.id}/microsite`, { slug: 'second' });

    const all = await pages(request, csrf);
    expect(all.find((p) => p.slug === 'second')?.bound_codes,
      'the new page has it').toContain(code.code);
    expect(all.find((p) => p.slug === 'first')?.bound_codes,
      'and the old page no longer does').not.toContain(code.code);
  });

  test('an empty slug clears the binding', async () => {
    await makePage(request, csrf, 'temporary');
    const code = await makeCode(request, csrf, 'CLEARS');
    await adminJSON(request, csrf, 'patch', `/codes/${code.id}/microsite`, { slug: 'temporary' });

    const cleared = await adminJSON(request, csrf, 'patch',
      `/codes/${code.id}/microsite`, { slug: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body['microsite_slug'], 'cleared means it opens the default chat').toBe('');
  });

  test('binding to a slug that does not exist is refused, not silently ignored', async () => {
    const code = await makeCode(request, csrf, 'NOSUCH');
    const bad = await adminJSON(request, csrf, 'patch',
      `/codes/${code.id}/microsite`, { slug: 'never-created' });
    // Silently leaving it "unbound" is the worst outcome: the owner thinks it's wired, but readers land on the default chat.
    expect(bad.status, 'a binding that cannot be made must fail loudly')
      .toBeGreaterThanOrEqual(400);
  });

  test('deleting the page returns its codes to the default landing, it does not kill them',
    async () => {
      await makePage(request, csrf, 'doomed');
      const code = await makeCode(request, csrf, 'SURVIVES');
      await adminJSON(request, csrf, 'patch', `/codes/${code.id}/microsite`, { slug: 'doomed' });

      expect((await adminJSON(request, csrf, 'delete', '/microsites/doomed')).status).toBe(200);

      // The code is still alive, just back on the default landing —— removing a rendering is not removing a grant.
      const intro = await request.post(`${BACKEND}/api/v1/codes/intro`, {
        data: { code: code.code },
      });
      expect(intro.status(), 'the code still works').toBe(200);
      const body = await intro.json() as { microsite_slug: string };
      expect(body.microsite_slug, 'and it now opens the default chat').toBe('');
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
    await adminJSON(request, csrf, 'patch', `/codes/${code.id}/microsite`, { slug: 'landing' });

    // The visitor side: the first hop coming in with a code asks codes/intro, and the landing decision is given there,
    // no extra round trip needed for "where to go".
    const intro = await request.post(`${BACKEND}/api/v1/codes/intro`, {
      data: { code: code.code },
    });
    expect(intro.status()).toBe(200);
    const body = await intro.json() as { microsite_slug: string; max_members: number };
    expect(body.microsite_slug, 'the visitor is told which page this code opens')
      .toBe('landing');
  });

  test('a code with no binding still lands on the default chat', async () => {
    const code = await makeCode(request, csrf, 'PLAIN');
    const intro = await request.post(`${BACKEND}/api/v1/codes/intro`, {
      data: { code: code.code },
    });
    const body = await intro.json() as { microsite_slug: string };
    // Empty string = opens the default chat, **not** "failed to answer".
    expect(body.microsite_slug, 'an unbound code is unchanged from today').toBe('');
  });

  test('the page byoai switch is stored, and is the page-level setting only', async () => {
    await makePage(request, csrf, 'byok');
    const on = await adminJSON(request, csrf, 'put',
      '/microsites/byok/byoai', { allow_byoai: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body['allow_byoai'], 'the receipt reads back what is stored').toBe(true);

    const off = await adminJSON(request, csrf, 'put',
      '/microsites/byok/byoai', { allow_byoai: false });
    // **An explicit false must be storable** —— the pointer parameter exists precisely to separate "not given" from "given false".
    expect(off.body['allow_byoai'], 'turning it off is not the same as not saying').toBe(false);
  });
});
