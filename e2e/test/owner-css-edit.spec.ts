// owner-css-edit.spec.ts —— owner CSS 三面可编辑 + parity(目标态红)。同一处 owner-级 CSS,能从
// admin UI / MCP / vault-sync(.obsidian/snippets + appearance.json 启用列表)任一面写,效果一致。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { uploadVault } from '@/fixtures/obsidian';
import { claimSyncOwner, syncOwner, type SyncOwner } from '@/fixtures/vault-sync';
import { adminSetCSS, adminGetCSS, mcpSetCSS } from '@/fixtures/presentation';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('cssed');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner CSS · three-surface edit + parity', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('UI: admin appearance editor sets owner CSS', uiSets);
  test('MCP: set_owner_css tool sets the same owner CSS', mcpSets);
  test('sync: .obsidian/snippets/*.css (enabled per appearance.json) is harvested', syncHarvests);
  test('sync: a DISABLED snippet is not harvested (matches Obsidian’s enabled list)', disabledSkipped);
});

async function uiSets({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await adminSetCSS(request, OWNER, '.note { color: rgb(1, 2, 3) }');
  expect(await adminGetCSS(request, OWNER), 'UI-set CSS stored').toContain('rgb(1, 2, 3)');
  await request.dispose();
}

async function mcpSets({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await mcpSetCSS(request, OWNER, '.note { color: rgb(4, 5, 6) }');
  expect(await adminGetCSS(request, OWNER), 'MCP-set CSS stored in the same place').toContain('rgb(4, 5, 6)');
  await request.dispose();
}

async function syncHarvests({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/x.md', body: '---\npublish: true\n---\nbody' },
    { rel: '.obsidian/snippets/mine.css', body: '.note { color: rgb(7, 8, 9) }' },
    { rel: '.obsidian/appearance.json', body: JSON.stringify({ enabledCssSnippets: ['mine'] }) },
  ]);
  expect(await adminGetCSS(request, OWNER), 'enabled snippet harvested from .obsidian/').toContain('rgb(7, 8, 9)');
  await request.dispose();
}

async function disabledSkipped({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: '.obsidian/snippets/on.css', body: '.a { color: rgb(10, 0, 0) }' },
    { rel: '.obsidian/snippets/off.css', body: '.b { color: rgb(0, 20, 0) }' },
    { rel: '.obsidian/appearance.json', body: JSON.stringify({ enabledCssSnippets: ['on'] }) },
  ]);
  const css = await adminGetCSS(request, OWNER);
  expect(css, 'enabled harvested (positive control)').toContain('rgb(10, 0, 0)');
  expect(css, 'disabled snippet NOT harvested').not.toContain('rgb(0, 20, 0)');
  await request.dispose();
}
