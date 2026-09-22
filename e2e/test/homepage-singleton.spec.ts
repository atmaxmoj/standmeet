// homepage-singleton.spec.ts — the reserved `home` page is a SINGLETON, proven end to end through
// the owner MCP → real backend → real DB (no fakes):
//   1. creating `home` twice returns the SAME row (get-or-restore, never a second, no tombstone),
//   2. `home` can never be deleted (the site root can't be self-inflicted-404'd).
//
// RED before the singleton work: create('home') a second time returned "slug already taken", and
// delete('home') succeeded and dropped the homepage.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI, createAPIToken } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'homesingleton@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'homesingleton',
  fullName: 'Home Singleton Owner',
};

interface MicrositePage { id: string; slug: string; status: string }

const createHome = (title: string): Promise<MicrositePage> =>
  callTool<MicrositePage>(ctx, token, sid, 'microsite.create', { slug: 'home', title });

let ctx: APIRequestContext;
let token = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('the reserved home page is a singleton', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(60_000);
    resetInstance();
    const req = await playwright.request.newContext();
    await claim(req, findSetupToken(), OWNER);
    await req.dispose();
    ctx = await playwright.request.newContext();
    const { csrf } = await loginAPI(ctx, OWNER.email, OWNER.password);
    token = await createAPIToken(ctx, csrf, 'home-singleton');
    sid = await initMCP(ctx, token);
  });

  test('creating home twice returns the same row — get-or-restore, never a second', async () => {
    const first = await createHome('Home');
    expect(first.slug, 'first create makes the home page').toBe('home');
    const second = await createHome('Home again');
    // The whole point: no "slug already taken", no duplicate — the same singleton row comes back.
    expect(second.id, 'creating home again returns the SAME row').toBe(first.id);
  });

  test('home cannot be deleted — the site root is a singleton', async () => {
    const page = await createHome('Home'); // idempotent: exists from the previous test, or created here
    await expect(
      callTool(ctx, token, sid, 'microsite.delete', { slug: 'home' }),
      'deleting the reserved home page must be refused',
    ).rejects.toThrow(/reserved/i);
    // still there, and still the SAME row (a refused delete changed nothing)
    const again = await createHome('Home');
    expect(again.id, 'home still exists as the same row after the refused delete').toBe(page.id);
  });
});
