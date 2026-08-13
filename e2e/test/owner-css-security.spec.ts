// owner-css-security.spec.ts —— owner CSS 是 user-provided → 攻击面(目标态红,安全核心)。
// store 时 sanitize(剥 @import / 外部 url() / expression / javascript:)+ scope(所有选择器锚到
// .corpus-content,动不了 app chrome)。每个 not-contains 前都有**正例守卫**(安全的规则要留存)——
// 否则 RED 阶段 GET 返空会让 not-contains 假绿(pentest 那条教训)。

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

// commentSurvives —— F-R-7：作用域器把第一个 `{` 之前的一切当成选择器列表，**开头的注释
// 整段落进去**，然后按逗号切开逐个加 `.corpus-content`。真 vault 的
// `.obsidian/snippets/i18n-switch.css` 因此存成
// `… switch, .corpus-content pure CSS, .corpus-content NO JavaScript …`。
//
// 今天的后果只是脏（`/* */` 仍然闭合，渲染语义没变）。但同一个盲区里藏着更硬的形状：
// 注释里出现 `{` / `}` 时，这个切法就不再只是"多几个前缀"。所以断言的是**注释原文一字不动**，
// 而不是"渲染看起来没坏" —— 后者今天就是真的，明天也挡不住任何东西。
async function commentSurvives({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const comment = '/* switcher v5 — per-note, pure CSS, NO JavaScript */';
  const stored = await storeThenGet(request, `${comment}\n.note { color: red }`);
  expect(stored, 'safe rule survives (positive control)').toContain('color: red');
  expect(stored, 'the comment comes back exactly as written').toContain(comment);
  await request.dispose();
}
