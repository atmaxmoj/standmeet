// owner-css-bypass.spec.ts —— RED repro (bug hunt #15). owner CSS is user-provided → security core.
// owner-css-security.spec.ts covers the sanitize/scope happy path; the bug hunt found two bypasses
// the current SanitizeAndScopeCSS (internal/usecases/owner_css.go) misses:
//
//   (a) reCSSExternalURL only strips `https?:` / `javascript:` schemes, so a PROTOCOL-RELATIVE
//       `url(//tracker/pixel.png)` sails through — the browser fetches it over the page protocol,
//       giving the same exfil/tracking channel the http(s) case is stripped to prevent.
//   (b) scopeRule returns any `@`-rule block unchanged, so selectors INSIDE `@media {…}` are never
//       anchored to .corpus-content — owner CSS restyles the real app chrome (clickjacking/redress),
//       exactly the threat the scoping is meant to close.
//
// Each assertion has a positive control (a safe rule survives) so a RED-phase empty GET can't fake
// a green not-contains. GREEN = boundary holds; currently RED.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimSyncOwner, syncOwner, type SyncOwner } from '@/fixtures/vault-sync';
import { adminSetCSS, adminGetCSS } from '@/fixtures/presentation';

const OWNER: SyncOwner = syncOwner('cssbypass');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner CSS · sanitize/scope bypasses (bug hunt #15)', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('protocol-relative url(//host) must be stripped like http(s)/javascript:', async ({
    playwright,
  }) => {
    const request = await playwright.request.newContext();
    const stored = await storeThenGet(request, [
      '.note { color: red }', // positive control — must survive
      '.leak { background: url(//tracker.example/pixel.png) }',
    ].join('\n'));
    expect(stored, 'safe rule survives — GET is real output, not empty').toContain('color: red');
    expect(stored, 'protocol-relative tracker url() stripped (no exfil)')
      .not.toContain('tracker.example');
    await request.dispose();
  });

  test('@media inner selectors must still be scoped to .corpus-content', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const stored = await storeThenGet(request, '@media screen { body { color: red } }');
    expect(stored, 'the owner rule is kept (scoped), not dropped').toContain('color: red');
    expect(stored, '@media inner rules are scoped under .corpus-content (cannot restyle chrome)')
      .toContain('.corpus-content');
    await request.dispose();
  });
});

async function storeThenGet(request: APIRequestContext, css: string): Promise<string> {
  await adminSetCSS(request, OWNER, css);
  return adminGetCSS(request, OWNER);
}
