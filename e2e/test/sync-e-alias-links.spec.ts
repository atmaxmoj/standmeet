// sync-e-alias-links.spec.ts —— frontmatter 的 `aliases:` 也能被 `[[...]]` 指到。
//
// 这条存在,是因为别名**解出来就扔了**:`obsidian/frontmatter.go` 把 `aliases` 读进结构体,
// 全仓没有任何地方用它。所以 owner 在 vault 里靠 Obsidian 的别名解析写的链接,同步进来就断 ——
// Obsidian 里点得动,网站上是一段字面量 `[[旧名字]]`。
//
// 不是回归,是从来没接过(owner 2026-08-05:"因为我们原来没用嘛")。多语言会让它从"偶尔"变成
// "成片" —— 中文那一版正文里的链接自然用中文名,而中文名正是 `aliases-zh` 的用处。
//
// **消歧不新增规则**:别名只是给解析器多一批候选来源,排序仍走既有的 pickByProximity
// (同 genre 优先,否则第一个非自身候选 —— 那是 F-L-10 修过的,旧版 last-write-wins 会让
// `[[X]]` 随机落到 raw 草稿、hub 笔记 backlinks 全空)。开第二套消歧就是在重犯那个错。

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

// aliasResolves —— 最小的那条:B 声明别名,A 用别名链过去 → A 有一条指向 B 的出边。
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

// everyAliasResolves —— 别名是个**池子**,不是一个。声明了 N 个就 N 个都能指到。
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

// cjkAlias —— 中文别名。这是多语言那一版正文里链接的**真实写法**,也是 aliases-zh 的用处。
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

// aliasProximity —— 两条笔记声明了**同一个别名**,一条在 wiki 一条在 raw。
// 从 wiki 链过去要落在 wiki 那条 —— 跟标题同名时的既有行为一致(F-L-10 修过的那个)。
//
// 这条断的是"**没有第二套消歧**"。别名要是自己带一套排序,这里会随机落到 raw 草稿。
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

// aliasIsPerNote —— 一条多语言笔记按语言声明别名(aliases-zh / aliases-en),但**链接目标是
// 那条笔记**,不是它的某个语言版本。所以两种语言的别名都解到同一个 id、只产生一条边。
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

// noAliasUnchanged —— 给现有全部笔记的回归保险:没有 aliases 的笔记,解析行为一个字不变。
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

// outboundOf —— 这条笔记的出边(目标**标题**列表),取自 admin 的 note_refs 面。
// 标题 == 文件名(vault 同步就是这么定的),所以下面各条用 basename 断言。
async function outboundOf(
  request: APIRequestContext, title: string, genre = 'wiki',
): Promise<string[]> {
  return (await adminNoteRefs(request, OWNER, genre, title)).outbound;
}
