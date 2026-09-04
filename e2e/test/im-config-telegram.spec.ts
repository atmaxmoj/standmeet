// im-config-telegram.spec.ts — the missing middle of the bots feature.
//
// im-bridge (a deployed Telegram bot) polls GET /internal/im/config for the owner's bot
// token and waits until one appears. That endpoint + a telegram connector didn't exist, so
// the bridge waited forever and the owner had no way to configure it. This proves the loop
// the bridge depends on: the owner connects a Telegram connector under /admin/connectors,
// and /internal/im/config then hands the bridge exactly that token — and hands back an
// **empty** token before anything is connected (the bridge's "not yet", not an error).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'imbot@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'imbot',
  fullName: 'IM Bot Owner',
};

const TOKEN = '7654321:BOTFATHER-abcdefghijklmnopqrstuvwxyz012345';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('telegram connector → /internal/im/config', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the bridge gets an empty token until the owner connects one, then gets it',
    async ({ request }) => {
      // 1. Nothing connected yet → empty token. This is the bridge's "wait" state (200, not
      //    an error): a missing endpoint here is the whole bug this fixes.
      expect(await imToken(request), 'no token before the owner connects one').toBe('');

      // 2. Owner connects a Telegram bot: create → credentials → connect (the same lane the
      //    admin UI's ProtocolConnectorForm drives).
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const created = await api(request, csrf, 'post', '/',
        { kind: 'protocol', protocol: 'telegram', category: 'im' });
      expect(created.status, 'create telegram connector').toBeLessThan(300);
      const id = created.body['id'] as string;
      expect(id, 'create returns a connector id').toBeTruthy();

      expect((await api(request, csrf, 'post', `/${id}/credentials`, { token: TOKEN })).status,
        'save the bot token').toBeLessThan(300);
      expect((await api(request, csrf, 'post', `/${id}/connect`, {})).status,
        'connect (no verify step for telegram) succeeds').toBe(200);

      // 3. Now the bridge endpoint hands back exactly the owner's token.
      expect(await imToken(request), 'the bridge now gets the owner’s bot token').toBe(TOKEN);
    });
});

async function imToken(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${BACKEND}/internal/im/config`);
  expect(res.status(), '/internal/im/config is served').toBe(200);
  const body = await res.json() as { telegram_token?: unknown };
  return typeof body.telegram_token === 'string' ? body.telegram_token : '<missing>';
}

async function api(
  request: APIRequestContext, csrf: string, method: 'get' | 'post' | 'put' | 'delete',
  path: string, data?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request[method](`${BACKEND}/api/admin/connectors${path}`, {
    headers: { 'X-Csrftoken': csrf },
    ...(data === undefined ? {} : { data }),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status(), body };
}
