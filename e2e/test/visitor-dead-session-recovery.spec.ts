// visitor-dead-session-recovery.spec.ts — once the backend session is invalidated (401), the
// client can no longer blithely keep holding onto the stale identity in localStorage and act as
// if it's still logged in.
//
// The backend session is the sole source of truth: the moment the token is rejected (expired /
// instance reset / revoked), the client must clear out the stale identity (name + quota +
// credentials), and route back to the entry point based on whether an access code is still held:
//   - a code is present → re-open the name picker (ask for a name and start a fresh session, as
//     on first entry)
//   - no code → fall back to /gate
//
// This tests the "code present" branch: once inside a session, corrupt the session_token in
// localStorage into a dead value, then reload → the name picker must reopen, and the stale
// credentials must be cleared.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'DEAD-001';
const NAME = 'Hana';
const CREDS_KEY = 'standmeet:visitor-session';
const DISPLAY_KEY = 'standmeet-session';

test.describe('session 失效 → 清旧身份,按有没有 code 回入口', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'dead-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('死 token + reload → 有 code 就重弹名字选择器,旧凭据清掉', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE, NAME);

    // Once inside the session, the name picker has closed and the strip shows the identity.
    await expect(page.getByTestId('visitor-name-overlay')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('session-strip-gauge')).toBeVisible({ timeout: 10_000 });

    // Corrupt the chat auth token into a dead value (simulating expiry / an instance reset).
    await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) throw new Error('no creds in localStorage');
      const parsed = JSON.parse(raw) as { session_token: string };
      parsed.session_token = 'dead-token-deadbeef';
      window.localStorage.setItem(key, JSON.stringify(parsed));
    }, CREDS_KEY);

    // reload → the snapshot uses the dead token against the backend → 401 → identity is
    // cleared, and since the code is still held, it gets pushed back into pending → the name
    // picker reopens.
    await page.reload();
    await expect(page.getByTestId('visitor-name-overlay')).toBeVisible({ timeout: 15_000 });

    // The stale credentials are cleared (the dead token isn't left around to keep hitting the
    // backend repeatedly); the displayed identity is cleared too.
    const creds = await page.evaluate((key) => window.localStorage.getItem(key), CREDS_KEY);
    expect(creds).toBeNull();
    const display = await page.evaluate((key) => window.localStorage.getItem(key), DISPLAY_KEY);
    expect(display).toBeNull();

    await ctx.close();
  });
});
