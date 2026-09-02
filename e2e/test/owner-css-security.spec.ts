// owner-css-security.spec.ts —— owner CSS is user-provided → an attack surface
// (target-state RED, security core). On store it gets sanitized (@import / external url() /
// expression / javascript: stripped) and scoped (every selector anchored under
// .corpus-content, so it can't touch the app chrome). Every not-contains assertion has a
// **positive control** in front of it (the safe rule must survive) — otherwise an empty GET
// during the RED phase would make not-contains falsely pass (the pentest lesson).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claimSyncOwner, syncOwner, type SyncOwner } from '@/fixtures/vault-sync';
import { adminSetCSS, adminGetCSS } from '@/fixtures/presentation';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('cssec');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner CSS · sanitize + scope', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('sanitize: @import + external url() + expression + javascript: are stripped', sanitizeStrips);
  test('scope: selectors are anchored to .corpus-content — cannot restyle app chrome', scopeAnchors);
  test('scope: a rule targeting app UI (body / .nav) cannot hide/hijack the real chrome', cannotHijack);
  test('scope: a comment comes back byte-identical — the scoper must not write inside it (F-R-7)',
    commentSurvives);
});

async function storeThenGet(request: APIRequestContext, css: string): Promise<string> {
  await adminSetCSS(request, OWNER, css);
  return adminGetCSS(request, OWNER);
}

async function sanitizeStrips({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const css = [
    '.note { color: red }', // safe — must survive (positive control)
    '@import url(http://evil.example/x.css);',
    '.leak { background: url(http://tracker.example/pixel.png) }',
    '.ie { width: expression(alert(1)) }',
    '.js { background: url(javascript:alert(1)) }',
  ].join('\n');
  const stored = await storeThenGet(request, css);
  expect(stored, 'safe rule survives — GET is real output, not empty').toContain('color: red');
  expect(stored, '@import stripped (no external fetch)').not.toContain('@import');
  expect(stored, 'external tracker url() stripped (no exfil)').not.toContain('tracker.example');
  expect(stored, 'expression() stripped').not.toContain('expression(');
  expect(stored.toLowerCase(), 'javascript: url stripped').not.toContain('javascript:');
  await request.dispose();
}

async function scopeAnchors({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const stored = await storeThenGet(request, '.note { color: red }');
  expect(stored, 'safe rule present (positive control)').toContain('color: red');
  expect(stored, 'every selector is scoped under .corpus-content').toContain('.corpus-content');
  await request.dispose();
}

async function cannotHijack({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const stored = await storeThenGet(request, 'body { color: red }\n.app-nav { display: none }');
  expect(stored, 'the owner rule is kept (scoped), not dropped wholesale').toContain('color: red');
  // scoped: a bare `body {` / `.app-nav {` at rule-start would restyle the real app — must be prefixed.
  expect(stored, 'no unscoped body selector reaches app chrome').not.toMatch(/(^|\})\s*body\s*\{/);
  expect(stored, 'no unscoped .app-nav reaches app chrome').not.toMatch(/(^|\})\s*\.app-nav\s*\{/);
  await request.dispose();
}

// commentSurvives —— F-R-7: the scoper treats everything before the first `{` as a selector
// list, so **a leading comment falls into that whole block**, then gets split on commas and
// prefixed with `.corpus-content` piece by piece. That's why the real vault's
// `.obsidian/snippets/i18n-switch.css` ends up stored as
// `… switch, .corpus-content pure CSS, .corpus-content NO JavaScript …`.
//
// Today the consequence is just mess (the `/* */` still closes, rendering semantics are
// unchanged). But the same blind spot hides a harder shape: once a comment contains `{` or
// `}`, this splitting stops being merely "a few extra prefixes". So what's asserted is
// **the comment text is byte-for-byte unchanged**, not "rendering looks fine" — the latter
// happens to be true today but won't guard against anything tomorrow.
async function commentSurvives({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const comment = '/* switcher v5 — per-note, pure CSS, NO JavaScript */';
  const stored = await storeThenGet(request, `${comment}\n.note { color: red }`);
  expect(stored, 'safe rule survives (positive control)').toContain('color: red');
  expect(stored, 'the comment comes back exactly as written').toContain(comment);
  await request.dispose();
}
