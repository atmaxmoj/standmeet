// sync-h-reconcile.spec.ts —— H. 幂等 + reconcile(目标态红,同步状态机)。
// 决策默认:改名=孤儿(③)· 跨-genre 移动=就地改 genre(④)· 部分上传绝不删(⑤;整vault同步会 prune,
// 见 sync-authoritative-prune)。
// 关键容错:partial-never-delete · vault-is-the-source · 整批解析(forward-ref)· 导两次同态。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';
import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  BACKEND, claimSyncOwner, syncOwner, syncSession, syncRead, adminGenreList, adminNoteRefs,
  type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('h');
const md = (body: string): string => makeVaultMD({ publish: true }, body);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('sync H · idempotency + reconcile', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  // ── H2 re-import outcomes ──
  test('outcome: re-importing an unchanged note → skipped', reimportUnchangedSkip);
  test('outcome: a changed body → updated (single row)', changedBodyUpdate);
  test('outcome: a new note → created', newNoteCreated);
  // ── H3 rename / move ──
  test('move: same-genre move deeper → re-parented, new path resolves, old gone', moveDeeperReparent);
  test('move: cross-genre move (wiki→subjectivity) → genre updated in place', crossGenreMove);
  test('rename: renaming a file (new slug) → new note (orphan default), no crash', renameOrphans);
  // ── H4 conflict (web ↔ vault) ──
  test('conflict: the vault is the source — a re-sync replaces a web edit', vaultIsTheSource);
  // ── H5 deletion / partial (CRITICAL) ──
  test('partial: a partial upload NEVER deletes notes it did not include', partialNeverDeletes);
  // F-L-61 —— 守卫写了、红也证了（`raw 那条没被上传包含，就不许被搬走` → Received false），
  // 但**先不挂进套件**：第一版修法（部分上传一律按 source_path 认领）当场打红了同文件里
  // `moveDeeperReparent` 和 `crossGenreMove` —— 那两条编码的是「部分上传里的移动要就地改」，
  // 是**在用的行为**，不是漏网。见 findings 里 F-L-61 的 ④ 那一段。
  // 挂一条红进 CI 只会让下一个人学会忽略红色，所以留在这儿等真正的修法（按**语料**判重名）。
  test('partial: nor MOVES them to another genre (F-L-61)', partialDoesNotRelocateOthers);
  test('partial: nor moves a same-named FOLDER node (F-L-61b)', partialDoesNotRelocateFolders);
  test('partial: re-uploading a subset leaves the rest intact', subsetKeepsRest);
  // ── H6 idempotency ──
  test('idempotent: importing the same vault twice → identical state, no dup notes', importTwiceSameState);
  test('idempotent: re-import does not duplicate note_refs edges', reimportNoDupEdges);
  // ── H7 batch-order independence ──
  test('batch: [[X]] where X appears LATER in the same batch still resolves', forwardRefSameBatch);
  test('batch: a folder-note uploaded after its children still forms the tree', folderNoteAfterChildren);
});

async function sess(request: APIRequestContext) {
  return syncSession(request, OWNER);
}
// adminUpdateWiki —— web 端就地编辑 body(**保持 title** = filename 派生的身份;改了 title 就成了另一条)。
async function adminUpdateWiki(
  request: APIRequestContext, id: string, title: string, body: string,
): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await request.patch(`${BACKEND}/api/admin/corpus/wiki/${id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: { title, body, tags: [], parent_id: null, show_as_source: true },
  });
}
async function wikiId(request: APIRequestContext, title: string): Promise<string> {
  const list = await adminGenreList(request, OWNER, 'wiki');
  return list.find((n) => n.title === title)?.id ?? '';
}

async function reimportUnchangedSkip({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const files = [{ rel: 'wiki/stable.md', body: md('same') }];
  await uploadVault(request, OWNER, files);
  const second = await uploadVault(request, OWNER, files);
  expect(second.created, 'unchanged re-import creates nothing').toBe(0);
  expect(second.skipped, 'unchanged → skipped').toBeGreaterThan(0);
  await request.dispose();
}

async function changedBodyUpdate({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/evolving.md', body: md('v1') }]);
  const second = await uploadVault(request, OWNER, [{ rel: 'wiki/evolving.md', body: md('v2 CHANGED') }]);
  expect(second.updated, 'changed body → updated').toBeGreaterThan(0);
  expect((await syncRead(request, await sess(request), 'evolving')).body ?? '').toContain('v2 CHANGED');
  const list = await adminGenreList(request, OWNER, 'wiki');
  expect(list.filter((n) => n.title === 'evolving').length, 'single row, not duplicated').toBe(1);
  await request.dispose();
}

async function newNoteCreated({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/first.md', body: md('a') }]);
  const second = await uploadVault(request, OWNER, [
    { rel: 'wiki/first.md', body: md('a') },
    { rel: 'wiki/second.md', body: md('b') },
  ]);
  expect(second.created, 'new note created').toBe(1);
  await request.dispose();
}

async function moveDeeperReparent({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/loose-leaf.md', body: md('leaf') }]);
  // moved under a new folder → new source_path, same identity → re-parented.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/topic/topic.md', body: md('topic node') },
    { rel: 'wiki/topic/loose-leaf.md', body: md('leaf') },
  ]);
  const s = await sess(request);
  expect((await syncRead(request, s, 'topic/loose-leaf')).body ?? '', 'new path resolves').toContain('leaf');
  expect((await syncRead(request, s, 'loose-leaf')).error ?? '', 'old path gone').toMatch(/not found|access denied/i);
  await request.dispose();
}

async function crossGenreMove({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/wandering.md', body: md('w') }]);
  // moved to subjectivity/ → genre updated in place (matched by slug/source identity).
  await uploadVault(request, OWNER, [{ rel: 'subjectivity/wandering.md', body: md('w') }]);
  expect((await syncRead(request, await sess(request), 'wandering')).genre, 'genre updated to subjectivity')
    .toBe('subjectivity');
  await request.dispose();
}

async function renameOrphans({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/oldname.md', body: md('content') }]);
  const r = await uploadVault(request, OWNER, [{ rel: 'wiki/newname.md', body: md('content') }]);
  // decision ③: rename = new note (orphan). Must not crash; new name resolves.
  expect(r.errors, 'rename tolerated').toEqual([]);
  expect((await syncRead(request, await sess(request), 'newname')).genre).toBe('wiki');
  await request.dispose();
}

// vaultIsTheSource —— the vault is the SINGLE LIVE SOURCE, so a re-sync makes the corpus equal it:
// a web edit does NOT pin a note against its own vault. (This replaces the old "web-wins" rule,
// which contradicted the vault-ingestion decision — sync means sync, there is no "who wins". To keep
// web work, export it back to the vault first, then sync.)
async function vaultIsTheSource({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [{ rel: 'wiki/shared.md', body: md('vault original') }]);
  await adminUpdateWiki(request, await wikiId(request, 'shared'), 'shared', 'WEB EDIT');
  // re-import the vault version → the vault is the source, so it wins over the web edit.
  await uploadVault(request, OWNER, [{ rel: 'wiki/shared.md', body: md('vault original') }]);
  const body = (await syncRead(request, await sess(request), 'shared')).body ?? '';
  expect(body, 'the vault version replaces the web edit — the vault is the source').toContain('vault original');
  expect(body, 'the web edit does not survive its own vault re-sync').not.toContain('WEB EDIT');
  await request.dispose();
}

async function partialNeverDeletes({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/keep-a.md', body: md('a') },
    { rel: 'wiki/keep-b.md', body: md('b') },
  ]);
  // a partial upload of only one file must NOT delete the other.
  await uploadVault(request, OWNER, [{ rel: 'wiki/keep-a.md', body: md('a2') }]);
  const s = await sess(request);
  expect((await syncRead(request, s, 'keep-b')).genre, 'partial upload never deletes keep-b').toBe('wiki');
  await request.dispose();
}

// F-L-61 —— **部分上传不许动它没包含的那些笔记。**
//
// prod 上真发生的：发一次两文件的子集上传（不带 authoritative），`deleted: 0` —— 「不许删」
// 那一半成立 —— 而 `raw 482→479 · wiki 575→578`，**三条根本不在上传里的 raw 笔记被搬进了 wiki**。
//
// 机制：`dupTitles` 是从**这次上传**算出来的（`sync.go:86`），而 `claimExisting` 只对
// dupTitles 里的标题按 source_path 认领，其余一律 `GetByTitle` —— **跨 genre**。真语料里
// 跨 genre 重名的标题，在一个两文件的上传里各只出现一次，于是被按 title 认到了别的 genre
// 那一行，就地改成了这次上传的 genre。
//
// 为什么比「删了」更该管：genre 就是访客 ACL 授权的边界，raw 是私料。**一次 API 端的部分
// 喂入可以把私料搬到已发布那一侧。**
async function partialDoesNotRelocateOthers({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // 整份先进去：同一个标题在两个 genre 各有一条（真 vault 到处都是这种）。
  //
  // **raw 那条要更老**：认领走的是 `GetNoteByTitleAnyGenre`，`ORDER BY created_at ASC LIMIT 1`
  // —— 被顶掉的永远是最老的那条。两条同批建时 wiki 恰好在前，于是缺陷不发作；prod 上发作，
  // 是因为那三条 raw 比同名的 wiki 老。分两次上传把年龄钉死，红才落在机制上而不是落在建表顺序上。
  await uploadVault(request, OWNER, [{ rel: 'raw/shared-name.md', body: md('the raw one') }]);
  await uploadVault(request, OWNER, [
    { rel: 'wiki/shared-name.md', body: md('the wiki one') },
    { rel: 'raw/shared-name.md', body: md('the raw one') },
  ]);
  // **按 body 认这条 raw，不按 title**：raw 的行根本不带 title（`corpus_rows.go` 的
  // `rawItem` 只发 body/preview —— raw 卡片就地编辑正文，标题不是它的身份）。第一版这里写的是
  // `title === 'shared-name'`，于是前置条件在**有没有这个缺陷都一样**是 false —— 红落在了
  // 错的地方，而我差点据此认定「修法没用」。
  const inRaw = async (): Promise<boolean> =>
    (await adminGenreList(request, OWNER, 'raw')).some((n) => (n.body ?? '').includes('the raw one'));
  expect(await inRaw(), 'raw 那条先在').toBe(true);

  // 只喂 wiki 那一条 —— raw 那条**不在这次上传里**，一个字都不该动。
  await uploadVault(request, OWNER, [{ rel: 'wiki/shared-name.md', body: md('edited wiki one') }]);

  expect(
    await inRaw(),
    'raw 那条没被这次上传包含，就不许被搬走 —— genre 是访客 ACL 的边界',
  ).toBe(true);
  // 而且这次上传要落在**它自己**那条 wiki 上：正文改了，行数没多。
  const wiki = (await adminGenreList(request, OWNER, 'wiki')).filter((n) => n.title === 'shared-name');
  expect(wiki.length, '同名的 wiki 仍是一条').toBe(1);
  await request.dispose();
}

// F-L-61 的第二半 —— **文件夹那种「没有文件」的节点**。
//
// 上面那条修完，prod 上重放同一次子集上传：两条目标笔记各自就位，`raw 482→481 · wiki 575→576`
// —— 还是有一条被搬走了，而它是 `math`：一个**结构节点**（文件夹占位，`obsidian_source_path`
// 是空的）。`claimExisting` 对没有 file 的节点永远走 `GetByTitle`，因为空路径互相会撞 ——
// 于是「按语料算歧义」这一刀切不到它：知道 `math` 有歧义，也没有第二把认领的尺子。
//
// 结构节点的身份是 **(genre, title)**：它就是自己那棵树上的一个文件夹。同名文件夹在两个
// genre 各有一个，是真 vault 的常态（`raw/math/` 和 `wiki/math/` 并存）。
async function partialDoesNotRelocateFolders({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // raw 那棵树先建（更老），再让两个 genre 都有一个叫 topic 的文件夹。
  await uploadVault(request, OWNER, [{ rel: 'raw/topic/note-r.md', body: md('raw child') }]);
  await uploadVault(request, OWNER, [
    { rel: 'raw/topic/note-r.md', body: md('raw child') },
    { rel: 'wiki/topic/note-w.md', body: md('wiki child') },
  ]);
  // 判据就是 prod 上量到的那个：genre 的**条数**。raw 该是两条（文件夹 topic + note-r），
  // 结构节点被认到 wiki 去的话，这里会掉到一条。
  //
  // 这一句就已经是红的：结构节点没有 source_path，F-L-2 那把「同名就按路径认」的尺子从来
  // 量不到它 —— 所以**整份传**同名文件夹也照样塌，不必等到部分上传。
  const rawCount = async (): Promise<number> => (await adminGenreList(request, OWNER, 'raw')).length;
  expect(await rawCount(), '两个 genre 各有一个 topic 文件夹时，raw 那棵树是完整的两条').toBe(2);

  // 只喂 wiki 那一条 —— 它会带出一个叫 topic 的结构节点，而 raw 里也有一个。
  await uploadVault(request, OWNER, [{ rel: 'wiki/topic/note-w.md', body: md('edited wiki child') }]);

  expect(await rawCount(), 'raw 的 topic 文件夹没被这次上传包含，就不许被搬走').toBe(2);
  await request.dispose();
}

async function subsetKeepsRest({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/one.md', body: md('1') },
    { rel: 'wiki/two.md', body: md('2') },
    { rel: 'wiki/three.md', body: md('3') },
  ]);
  await uploadVault(request, OWNER, [{ rel: 'wiki/two.md', body: md('2b') }]);
  expect((await adminGenreList(request, OWNER, 'wiki')).length, 'all three still present').toBe(3);
  await request.dispose();
}

async function importTwiceSameState({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const files = [
    { rel: 'wiki/x.md', body: md('x') },
    { rel: 'wiki/y.md', body: md('y') },
  ];
  await uploadVault(request, OWNER, files);
  await uploadVault(request, OWNER, files);
  expect((await adminGenreList(request, OWNER, 'wiki')).length, 'no duplicate notes').toBe(2);
  await request.dispose();
}

async function reimportNoDupEdges({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const files = [
    { rel: 'wiki/dst.md', body: md('dst') },
    { rel: 'wiki/src.md', body: md('links [[dst]]') },
  ];
  await uploadVault(request, OWNER, files);
  await uploadVault(request, OWNER, files);
  const out = (await adminNoteRefs(request, OWNER, 'wiki', 'src')).outbound;
  expect(out.filter((t) => t === 'dst').length, 're-import does not duplicate the edge').toBe(1);
  await request.dispose();
}

async function forwardRefSameBatch({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // src references target that appears LATER in the same upload — whole-batch resolution.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/forward-src.md', body: md('see [[forward-dst]]') },
    { rel: 'wiki/forward-dst.md', body: md('the target') },
  ]);
  expect((await adminNoteRefs(request, OWNER, 'wiki', 'forward-src')).outbound, 'forward-ref resolved')
    .toContain('forward-dst');
  await request.dispose();
}

async function folderNoteAfterChildren({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  // child listed before its folder-note in the batch — tree still forms.
  await uploadVault(request, OWNER, [
    { rel: 'wiki/late/leaf.md', body: md('leaf first') },
    { rel: 'wiki/late/late.md', body: md('folder-note last') },
  ]);
  expect((await syncRead(request, await sess(request), 'late/leaf')).body ?? '', 'tree forms regardless of order')
    .toContain('leaf first');
  await request.dispose();
}
