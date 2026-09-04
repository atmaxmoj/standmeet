// embed-snippet-reveal.spec.ts — the Embeds panel's one-time snippet reveal.
//
// The owner exposes an access code as a <standmeet-chat> widget for someone else's site.
// On create, the panel pops a **one-time** reveal with the paste-ready snippet — the only
// moment the per-embed private key is shown. The security thesis of the whole feature is
// that this snippet carries the embed id + key id + private KEY, and **never the plaintext
// access code** (the code stays server-side; the widget authenticates with a signed token).
//
// That thesis was only proven server-side (embed-token-auth.spec.ts). Here it's proven at
// the surface the owner actually copies from: a coverage gap found by the recent-features
// audit — the panel could emit a malformed snippet or leak the code and no test would catch it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'embedsnippet@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'embedsnippet',
  fullName: 'Embed Snippet Owner',
};

const CODE = 'EMBED-SNIPPET';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('embeds panel · one-time snippet reveal', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('creating an embed from the panel reveals a snippet that carries the key, not the code',
    async ({ request, adminPage }) => {
      // An unattached code for the picker to offer (an embed is "a code's widget rendering").
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const role = await createRole(request, csrf, { name: 'Embed Role' });
      const code = await createCode(request, csrf,
        { code: CODE, label: 'partner widget', assumed_role_id: role.id });

      await gotoAdminSection(adminPage, 'embeds');
      await adminPage.waitForURL('**/admin/embeds', { timeout: 5_000 });

      // Create through the panel: new → pick the code → label → save.
      await adminPage.getByRole('button', { name: /new embed/i }).click();
      await adminPage.getByTestId('embed-code').selectOption(code.id);
      await adminPage.getByTestId('embed-label').fill('Partner Site');
      await adminPage.getByTestId('embed-save').click();

      // The one-time reveal. This is the artifact the owner pastes into their site.
      const snippet = adminPage.getByTestId('embed-reveal-snippet');
      await expect(snippet, 'the snippet reveal pops after create').toBeVisible({ timeout: 10_000 });
      const text = await snippet.innerText();
      expect(text, 'it is the <standmeet-chat> widget tag').toContain('<standmeet-chat');
      expect(text, 'carries the embed id').toMatch(/embed="[0-9a-f-]{8,}"/);
      expect(text, 'carries the key id (kid)').toMatch(/kid="[^"]+"/);
      expect(text, 'carries the per-embed private key — the whole point of the one-time reveal')
        .toMatch(/key="[^"]+"/);
      // The thesis: a snippet pasted on someone else's site must NEVER carry the plaintext
      // access code. The widget authenticates with a signed token; the code stays server-side.
      expect(text, 'the snippet must not leak the access code').not.toContain(CODE);

      // The embed really exists now (server-side), so the list has it.
      expect(await embedCount(request, csrf), 'the embed was created').toBeGreaterThan(0);
    });
});

async function embedCount(request: APIRequestContext, csrf: string): Promise<number> {
  const res = await request.get(`${BACKEND}/api/admin/embeds`, { headers: { 'X-Csrftoken': csrf } });
  const rows = await res.json().catch(() => []) as unknown[];
  return Array.isArray(rows) ? rows.length : 0;
}
