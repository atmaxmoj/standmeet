// default-homepage-installed-on-claim.spec.ts —— claiming an instance installs the default
// homepage as the reserved `home` custom page (a draft, pre-loaded with the design-system
// template), ready for the owner to publish.
//
// This is the payoff of homepage-as-microsite: a fresh instance already has a homepage as a
// real, editable custom page — the owner publishes it (build + promote) and it serves at `/`
// (that serving path is covered end-to-end by homepage-served-at-root.spec.ts). The install is
// best-effort and deliberately does NOT auto-build/promote (no ad-hoc timer), so this asserts the
// draft exists after claim. If the install regressed, no `home` page would appear.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'defaulthome@example.com', password: 'correct-horse-battery-staple',
  handle: 'defaulthome', fullName: 'Default Home Owner',
};

test.describe('claiming an instance installs the default homepage as a draft', () => {
  test('the reserved `home` custom page is pre-loaded, ready to publish', async ({ request }) => {
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);

    const res = await request.get(`${BACKEND}/api/admin/microsites`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect(res.ok(), `list custom pages should be 200, got ${res.status()}`).toBeTruthy();
    const text = await res.text();
    expect(text, 'a `home` custom page must be installed at claim').toMatch(/"slug"\s*:\s*"home"/);
  });
});
