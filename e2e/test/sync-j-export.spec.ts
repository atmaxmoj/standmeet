// sync-j-export.spec.ts —— J. export / bidirectional (target-state RED, the second half of the sync face).
// corpus_notes → vault zip: each genre → its folder · tree → nested folders · note → `<title>.md` ·
// folder-note generation · `[[links]]` restored · frontmatter rebuilt. Bidirectional: web-edit reflects into export; round-trip is stable.

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
  test('happy: exported note keeps lang + aliases (F-L-59)', exportKeepsLangAndAliases);
  test('happy: subjectivity note exports under subjectivity/', exportSubjectivity);
  // ── corner ──
  test('corner: a [[link]] survives the round to the exported body', exportLinksPreserved);
  test('corner: a web edit is reflected in the export', exportReflectsWebEdit);
  // ── error / roundtrip ──
  test('roundtrip: import → export → re-import → identical state (no drift)', roundtripStable);
  test('roundtrip: a vault buried in hidden files exports back to EXACTLY its content',
    roundtripHiddenFidelity);
});

// HIDDEN_NOISE —— what a real vault actually drags along. A real Obsidian vault is normally a git
// repo (.git), often has local trash, editor and tool dirs. None of it is content: none may become
// a note, and none may come back out of the export.
const HIDDEN_NOISE = [
  { rel: '.git/objects/ab/deadbeef', body: 'binary-ish git object' },
  { rel: '.git/HEAD', body: 'ref: refs/heads/main' },
  { rel: '.git/config', body: '[core]\n\trepositoryformatversion = 0' },
  { rel: '.trash/deleted-note.md', body: 'a note the owner DELETED — must never resurrect' },
  { rel: '.claude/settings.json', body: '{}' },
  { rel: '.scripts/build.sh', body: '#!/bin/sh' },
  { rel: '.gitignore', body: '.obsidian/workspace.json' },
  { rel: '_templates/daily.md', body: 'template, not content' },
  { rel: 'wiki/.hidden-in-genre.md', body: 'a dotfile inside a genre folder' },
];

// CONTENT —— the actual vault: a tree, a link, a private tier, an inbox note.
const CONTENT = [
  { rel: 'wiki/cybernetics/cybernetics.md', body: md('the node index') },
  { rel: 'wiki/cybernetics/ashby.md', body: md('requisite variety, see [[kepler]]') },
  { rel: 'wiki/kepler.md', body: md('orbits are ellipses') },
  { rel: 'subjectivity/standpoint.md', body: md('a take I hold') },
  { rel: 'raw/scratch.md', body: md('half-formed') },
];

// roundtripHiddenFidelity —— the fidelity question the count-only roundtrip never asked: bury the
// vault in hidden noise, import it, export it, and compare the exported vault to the ORIGINAL
// content file-by-file. Two ways this can fail, both silent:
//   * LEAK — a hidden file became a note and comes back out (`.trash/` resurrecting a deleted note
//     is the nastiest: the owner deleted it on purpose).
//   * LOSS — a real note does not survive the round, or its body is mangled.
// Byte-equality is the wrong bar (frontmatter is reconstructed, key order is not preserved), so this
// asserts the set of content paths AND that every original body text survives intact.
async function roundtripHiddenFidelity({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [...HIDDEN_NOISE, ...CONTENT], { authoritative: true });

  const zip = await exportEntries(request);
  const exported = Object.keys(zip).filter((k) => k.endsWith('.md')).map(stripVaultPrefix).sort();

  // 1. NOTHING LEAKED — no hidden path, and above all no resurrected trash.
  const leaked = Object.keys(zip).filter((k) => /(^|\/)\.|_templates\//.test(stripVaultPrefix(k)));
  expect(leaked, 'no hidden file may survive as corpus content').toEqual([]);
  expect(Object.keys(zip).some((k) => k.includes('deleted-note')),
    '.trash/ must never resurrect a note the owner deleted').toBe(false);

  // 2. NOTHING LOST — every content note comes back at its own path.
  expect(exported, 'the exported vault is exactly the original content').toEqual(
    CONTENT.map((f) => f.rel).sort(),
  );

  // 3. NOTHING MANGLED — each body survives the round, links included.
  for (const f of CONTENT) {
    const got = Object.entries(zip).find(([k]) => stripVaultPrefix(k) === f.rel)?.[1] ?? '';
    const originalProse = bodyTextOf(f.body);
    expect(got, `${f.rel} keeps its body through the round`).toContain(originalProse);
  }
  await request.dispose();
}

// stripVaultPrefix —— export nests under a vault folder; compare on the genre-relative path.
function stripVaultPrefix(k: string): string {
  return k.replace(/^.*?(wiki\/|subjectivity\/|raw\/|writings\/)/, '$1');
}

// bodyTextOf —— the prose of a makeVaultMD fixture (drop the frontmatter block, which export
// legitimately reconstructs rather than echoes).
function bodyTextOf(md: string): string {
  return md.replace(/^---[\s\S]*?---\n/, '').trim();
}

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

// F-L-59: **export dropped the language contract and aliases**, and the `exportFrontmatter` case can't see it ——
// it only asserts `publish`, one of the two things export **happens to write**. When the criterion follows the implementation, it never catches what the implementation left out.
//
// Measured on prod: **every one** of the real vault's 575 wiki notes carries `lang` / `langs` / `aliases`,
// the 575 exported ones have **none**; yet in the DB `has_lang = 575`, `has_aliases = 575` —— the fact is right
// on the row export reads from. The round-trip's next step is "import the export back", and that step would flatten these two on the real corpus:
// aliases feed into link resolution (`[[alias]]` would no longer resolve), lang/langs are the multilingual rendering contract.
async function exportKeepsLangAndAliases({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{
    rel: 'wiki/bilingual.md',
    body: makeVaultMD(
      { publish: true, lang: 'en', langs: ['en', 'zh'], aliases: ['另一个名字'] },
      'body',
    ),
  }]);
  const zip = await exportEntries(request);
  const entry = Object.entries(zip).find(([k]) => k.endsWith('wiki/bilingual.md'))?.[1] ?? '';
  expect(entry, '导出的确实是这条笔记').toContain('body');
  expect(entry, 'aliases 必须回到导出的 frontmatter —— 它是链接解析的输入').toContain('另一个名字');
  expect(entry, '语言标记必须回到导出的 frontmatter').toMatch(/^lang:\s*en/m);
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
