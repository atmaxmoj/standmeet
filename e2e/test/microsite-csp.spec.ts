// microsite-csp.spec.ts —— a served microsite carries a Content-Security-Policy (refactor ledger
// R20), and the page still renders under it.
//
// The policy closes what a hosted page must never allow and touches nothing the owner's own code
// relies on: no other site may frame the page (clickjacking), no plugin objects, and <base> may
// only point at this origin (the server injects one). Scripts, styles, images and connections are
// not restricted: the server injects an inline script, chat cards render in srcdoc iframes that
// inherit the policy, and an owner's page may load images or fonts from anywhere.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { publishPage } from '@/fixtures/microsite-rig';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'csp@example.com', password: 'microsite-csp-pass-1',
  handle: 'cspowner', fullName: 'CSP Owner',
};

test.describe('a served microsite carries a content security policy', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(600_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await publishPage(request, csrf, 'csp', `export default function App() {
  return <main data-testid="microsite">csp page</main>;
}`);
    await request.dispose();
  });

  test('the page is served with the policy and renders under it', async ({ page, request }) => {
    const csp = (await request.get('/p/csp/')).headers()['content-security-policy'] ?? '';
    for (const d of ["frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'"]) {
      expect(csp, `policy has ${d}`).toContain(d);
    }
    await openReader(page, '/p/csp/');
    await expect(page.getByTestId('microsite')).toHaveText('csp page');
  });
});
