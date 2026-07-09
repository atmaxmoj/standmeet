// sync-j-export.spec.ts —— J. export / 双向(目标态红,sync face 的第二半)。
// corpus_notes → vault zip:每 genre → 其 folder · 树 → folder 嵌套 · note → `<title>.md` ·
// folder-note 生成 · `[[links]]` 还原 · frontmatter 重建。双向:web-edit 反映到 export;round-trip 稳。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';
import * as fflate from 'fflate';

import { login as loginAPI } from '@/fixtures/admin';
import { makeVaultMD, uploadVault, downloadExport } from '@/fixtures/obsidian';
import {
  BACKEND, claimSyncOwner, syncOwner, adminGenreList, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('j');
const md = (body: string): string => makeVaultMD({ publish: true }, body);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync J · export / bidirectional', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── happy ──
  test('happy: export puts a wiki note at wiki/<title>.md', exportGenreFolder);
  test('happy: export nests the tree as folders + folder-notes', exportTree);
  test('happy: exported note reconstructs frontmatter (publish/tags)', exportFrontmatter);
  test('happy: subjectivity note exports under subjectivity/', exportSubjectivity);
  // ── corner ──
  test('corner: a [[link]] survives the round to the exported body', exportLinksPreserved);
  test('corner: a web edit is reflected in the export', exportReflectsWebEdit);
  // ── error / roundtrip ──
  test('roundtrip: import → export → re-import → identical state (no drift)', roundtripStable);
});

function unzip(buf: Buffer): Record<string, string> {
  const files = fflate.unzipSync(new Uint8Array(buf));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) out[k] = new TextDecoder().decode(v);
  return out;
}
async function exportEntries(request: APIRequestContext): Promise<Record<string, string>> {
  return unzip(await downloadExport(request, OWNER));
}

async function exportGenreFolder({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/ashby.md', body: md('variety') }]);
  const zip = await exportEntries(request);
  expect(Object.keys(zip).some((k) => k.endsWith('wiki/ashby.md')), 'exported at wiki/ashby.md').toBe(true);
  await request.dispose();
}

async function exportTree({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/cybernetics/cybernetics.md', body: md('node') },
    { rel: 'wiki/cybernetics/theory/theory.md', body: md('node') },
    { rel: 'wiki/cybernetics/theory/ashby.md', body: md('leaf') },
  ]);
  const keys = Object.keys(await exportEntries(request));
  expect(keys.some((k) => k.endsWith('wiki/cybernetics/cybernetics.md')), 'folder-note exported').toBe(true);
  expect(keys.some((k) => k.endsWith('wiki/cybernetics/theory/ashby.md')), 'nested leaf exported').toBe(true);
  await request.dispose();
}

async function exportFrontmatter({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/fm.md', body: md('body') }]);
  const zip = await exportEntries(request);
  const entry = Object.entries(zip).find(([k]) => k.endsWith('wiki/fm.md'))?.[1] ?? '';
  expect(entry, 'frontmatter reconstructed').toMatch(/^---[\s\S]*publish:\s*true[\s\S]*---/m);
  await request.dispose();
}

async function exportSubjectivity({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'subjectivity/taste.md', body: md('taste') }]);
  const keys = Object.keys(await exportEntries(request));
  expect(keys.some((k) => k.endsWith('subjectivity/taste.md')), 'subjectivity exported to its folder').toBe(true);
  await request.dispose();
}

async function exportLinksPreserved({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/dst.md', body: md('dst') },
    { rel: 'wiki/src.md', body: md('see [[dst]]') },
  ]);
  const zip = await exportEntries(request);
  const src = Object.entries(zip).find(([k]) => k.endsWith('wiki/src.md'))?.[1] ?? '';
  expect(src, '[[link]] preserved in exported body').toContain('[[dst]]');
  await request.dispose();
}

async function exportReflectsWebEdit({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/edited.md', body: md('vault original') }]);
  const id = (await adminGenreList(request, OWNER, 'wiki')).find((n) => n.title === 'edited')?.id ?? '';
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await request.patch(`${BACKEND}/api/admin/corpus/wiki/${id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: { title: 'edited', body: 'WEBEDITKW body', tags: [], parent_id: null, show_as_source: true },
  });
  const zip = await exportEntries(request);
  const entry = Object.entries(zip).find(([k]) => k.endsWith('wiki/edited.md'))?.[1] ?? '';
  expect(entry, 'web edit reflected in export').toContain('WEBEDITKW');
  await request.dispose();
}

async function roundtripStable({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const files = [
    { rel: 'wiki/a.md', body: md('a') },
    { rel: 'wiki/b.md', body: md('links [[a]]') },
  ];
  await uploadVault(request, OWNER, files);
  const before = (await adminGenreList(request, OWNER, 'wiki')).length;
  // export → re-import the exported vault → state unchanged (no drift, no dup).
  const zip = await exportEntries(request);
  const reupload = Object.entries(zip)
    .filter(([k]) => k.endsWith('.md'))
    .map(([k, v]) => ({ rel: k.replace(/^.*?(wiki\/|subjectivity\/|raw\/)/, '$1'), body: v }));
  await uploadVault(request, OWNER, reupload);
  const after = (await adminGenreList(request, OWNER, 'wiki')).length;
  expect(after, 'round-trip is idempotent — no new/duplicate notes').toBe(before);
  await request.dispose();
}
