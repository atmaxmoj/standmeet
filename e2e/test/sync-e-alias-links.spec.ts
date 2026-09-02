// sync-e-alias-links.spec.ts —— frontmatter's `aliases:` can also be pointed at by
// `[[...]]`.
//
// This spec exists because an alias **gets parsed and then thrown away**:
// `obsidian/frontmatter.go` reads `aliases` into the struct, and nothing anywhere in
// the repo uses it. So a link the owner wrote using Obsidian's alias resolution in the
// vault breaks once synced in — clickable in Obsidian, a literal `[[old-name]]` on the
// website.
//
// This isn't a regression, it was never wired up at all (owner, 2026-08-05: "because
// we never used it before"). Multi-language content turns this from occasional into
// widespread — links inside the Chinese-language version of a body naturally use the
// Chinese name, and that's exactly what `aliases-zh` is for.
//
// **Disambiguation gets no new rule**: an alias is just another candidate source fed to
// the resolver, and ordering still goes through the existing pickByProximity (same
// genre preferred, otherwise the first non-self candidate — this is what F-L-10 fixed;
// the old last-write-wins version would send `[[X]]` to a random raw draft, leaving hub
// notes with empty backlinks). Standing up a second disambiguation path would just be
// repeating that mistake.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, adminNoteRefs, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('alias');
const md = (body: string): string => makeVaultMD({ publish: true }, body);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('sync E · frontmatter aliases 也参与 [[link]] 解析', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('happy: [[别名]] 解出一条指向该笔记的边', aliasResolves);
  test('happy: 同一条笔记的多个别名都指得到它', everyAliasResolves);
  test('happy: 中文别名(多语言那一版正文里的写法)', cjkAlias);
  test('消歧不变:别名候选跟标题候选走同一套 proximity(同 genre 优先)', aliasProximity);
  test('别名指到的是笔记本身,不是"某个语言版本"', aliasIsPerNote);
  test('没声明别名的笔记,行为跟今天一模一样', noAliasUnchanged);
});

// aliasResolves —— the minimal case: B declares an alias, A links to it via the
// alias → A gets an outbound edge pointing to B.
async function aliasResolves({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    {
      rel: 'wiki/good-regulator-theorem.md',
      body: makeVaultMD({ publish: true, aliases: ['GRT'] }, 'the theorem'),
    },
    { rel: 'wiki/ashby.md', body: md('see [[GRT]]') },
  ]);
  expect(
    await outboundOf(request, 'ashby'),
    '别名没接上的话这里是空的 —— 链接在 Obsidian 里点得动,同步进来就成了一段字面量',
  ).toContain('good-regulator-theorem');
  await request.dispose();
}

// everyAliasResolves —— aliases are a **pool**, not a single value. Declare N of them
// and all N can be linked to.
async function everyAliasResolves({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    {
      rel: 'wiki/good-regulator-theorem.md',
      body: makeVaultMD({ publish: true, aliases: ['GRT', 'Conant-Ashby'] }, 'the theorem'),
    },
    { rel: 'wiki/ashby.md', body: md('[[GRT]] and [[Conant-Ashby]]') },
  ]);
  const out = await outboundOf(request, 'ashby');
  expect(out, '两个别名指的是同一条,边去重后只该有一条').toEqual(['good-regulator-theorem']);
  await request.dispose();
}

// cjkAlias —— a Chinese-language alias. This is the **actual way** links look inside
// the multi-language version of a body, and it's exactly what aliases-zh is for.
async function cjkAlias({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    {
      rel: 'wiki/dynamics-to-a-fixed-point.md',
      body: makeVaultMD({ publish: true, aliases: ['流向不动点的动力学'] }, 'the note'),
    },
    { rel: 'wiki/ashby.md', body: md('见 [[流向不动点的动力学]]') },
  ]);
  expect(await outboundOf(request, 'ashby')).toContain('dynamics-to-a-fixed-point');
  await request.dispose();
}

// aliasProximity —— two notes declare **the same alias**, one in wiki, one in raw.
// Linking to it from wiki should land on the wiki one — consistent with the existing
// behavior for same-titled notes (the thing F-L-10 fixed).
//
// This asserts "**there is no second disambiguation path**". If aliases carried their
// own ordering, this could land randomly on the raw draft instead.
async function aliasProximity({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    {
      rel: 'raw/regulator-draft.md',
      body: makeVaultMD({ publish: true, aliases: ['REG'] }, 'the draft'),
    },
    {
      rel: 'wiki/regulator.md',
      body: makeVaultMD({ publish: true, aliases: ['REG'] }, 'the wiki one'),
    },
    { rel: 'wiki/ashby.md', body: md('see [[REG]]') },
  ]);
  expect(
    await outboundOf(request, 'ashby'),
    '同 genre 优先 —— 落到 raw 草稿就是又一次 last-write-wins',
  ).toEqual(['regulator']);
  await request.dispose();
}

// aliasIsPerNote —— a multi-language note declares per-language aliases (aliases-zh /
// aliases-en), but **the link target is the note itself**, not any one of its
// language versions. So aliases in either language resolve to the same id, producing
// only one edge.
async function aliasIsPerNote({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    {
      rel: 'wiki/expectancy-disconfirmation.md',
      body: makeVaultMD(
        { publish: true, lang: 'en', langs: ['en', 'zh'], aliases: ['期望失验', 'ED'] },
        'the note',
      ),
    },
    { rel: 'wiki/ashby.md', body: md('[[期望失验]] 也叫 [[ED]]') },
  ]);
  expect(
    await outboundOf(request, 'ashby'),
    '别名分语言声明,但指的是同一条笔记 —— 不该出现两条边',
  ).toEqual(['expectancy-disconfirmation']);
  await request.dispose();
}

// noAliasUnchanged —— a regression guarantee for every existing note: a note with no
// aliases resolves exactly the way it always did.
async function noAliasUnchanged({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/good-regulator-theorem.md', body: md('the theorem') },
    { rel: 'wiki/ashby.md', body: md('see [[good-regulator-theorem]] and [[nope]]') },
  ]);
  const out = await outboundOf(request, 'ashby');
  expect(out).toEqual(['good-regulator-theorem']);
  expect(out, '解不到的仍然解不到 —— 别名不该把未命中变成乱命中').not.toContain('nope');
  await request.dispose();
}

// outboundOf —— this note's outbound edges (a list of target **titles**), taken from
// the admin note_refs surface. Title == filename (that's how vault sync defines it),
// so the tests below assert on basename.
async function outboundOf(
  request: APIRequestContext, title: string, genre = 'wiki',
): Promise<string[]> {
  return (await adminNoteRefs(request, OWNER, genre, title)).outbound;
}
