// cssclasses-surfaces.spec.ts —— `cssclasses` frontmatter(per-note:哪条 note 挂哪些 CSS class)
// 三面可编辑 + parity(目标态红)。sync 采集 `cssclasses` · admin note-edit 带 css_classes · MCP
// 写工具带 css_classes —— 任一面设的 class,读回一致(render 时加到 note 容器)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { login as loginAPI, createAPIToken } from '@/fixtures/admin';
import { initMCP, callTool } from '@/fixtures/mcp';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  BACKEND, claimSyncOwner, syncOwner, syncSession, syncRead, adminGenreList, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('cssc');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('cssclasses · three-surface edit', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('sync: cssclasses frontmatter is carried onto the note', syncCarries);
  test('sync: no cssclasses → empty (no classes)', syncNone);
  test('UI: admin note-edit sets css_classes', uiSets);
  test('MCP: a note write tool sets css_classes', mcpSets);
});

async function classesOf(request: APIRequestContext, path: string): Promise<string[]> {
  const sess = await syncSession(request, OWNER);
  return (await syncRead(request, sess, path)).css_classes ?? [];
}

async function syncCarries({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/styled.md', body: makeVaultMD({ publish: true, cssclasses: ['theorem', 'wide'] }, 'x') },
  ]);
  expect(await classesOf(request, 'styled'), 'cssclasses carried').toEqual(['theorem', 'wide']);
  await request.dispose();
}

async function syncNone({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/plain.md', body: makeVaultMD({ publish: true }, 'x') }]);
  expect(await classesOf(request, 'plain'), 'no cssclasses → empty').toEqual([]);
  await request.dispose();
}

async function uiSets({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/ui.md', body: makeVaultMD({ publish: true }, 'x') }]);
  const id = (await adminGenreList(request, OWNER, 'wiki')).find((n) => n.title === 'ui')?.id ?? '';
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await request.patch(`${BACKEND}/api/admin/corpus/wiki/${id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: { title: 'ui', body: 'x', tags: [], parent_id: null, show_as_source: true, css_classes: ['boxed'] },
  });
  expect(await classesOf(request, 'ui'), 'UI-set css_classes').toEqual(['boxed']);
  await request.dispose();
}

async function mcpSets({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, `cssc-mcp-${OWNER.handle}`);
  const sid = await initMCP(request, token);
  await callTool(request, token, sid, 'subjectivity_write', {
    title: 'self', body: 'my self-model', css_classes: ['persona'],
  });
  expect(await classesOf(request, 'self'), 'MCP-set css_classes').toEqual(['persona']);
  await request.dispose();
}
