// vault-roundtrip-noop.spec.ts —— **同步上去、同步下来，中间什么都没做 → vault 一个字节都不该变。**
//
// 为什么要有这条:这个产品把 vault 当**镜像**卖。而 owner 的 vault 通常是个 git 仓库
// (真的那个是:1081 篇 md,48 MB,带 .git)。所以「往返之后文件不一样」不是一个抽象的洁癖问题 ——
// 它的样子是:每同步一次,git 里就多出几百个 diff,而 owner 一个字都没改过。
// 从此他没法用 `git status` 回答「我改了什么」,这正是他养 vault 的理由之一。
//
// 既有的 `sync-j-export.spec.ts` 里有一条叫 roundtrip 的用例,但它**自己声明了不断字节相等**:
// 「Byte-equality is the wrong bar (frontmatter is reconstructed, key order is not preserved)」,
// 判据降到了 `toContain(原文散文)` + 路径集合相等。也就是说,「往返把文件重写了」这件事
// 它结构上判不出来 —— 它绿的时候和文件被改写的时候长得一模一样
// ([[verifier-can-lie-about-its-own-coverage]])。
//
// 所以这条分开问两个问题,答案不一样时它们的意义完全不同:
//
//   ① 一次往返:出来的字节 == 进去的字节？—— owner 问的就是这句。
//   ② 两次往返:第二次的产物 == 第一次的产物？—— **收敛**。
//      ① 红而 ② 绿  = 第一次同步会重写一遍你的库,之后稳定(一次性的迁移代价)。
//      ① 红而 ② 也红 = 每一次同步都产生 diff,永远。那是另一个量级的缺陷。
//
// 喂的是**真 vault**,不是合成的:frontmatter 的写法、中文标题、附件引用、目录深度,
// 合成夹具挑不出这些形状,而重写恰恰发生在这些形状上([[stand-in-is-politer-than-reality]])。
// 真 vault 不在 = skip,并且**说出来**:一条静默跳过的用例跟通过长得一样。

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

import * as fflate from 'fflate';
import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { uploadVault, downloadExport, type VaultFile } from '@/fixtures/obsidian';

const OWNER = {
  email: 'vault-roundtrip@example.com', password: 'correct-horse-battery-staple',
  handle: 'vaultroundtrip', fullName: 'Vault Roundtrip Owner',
};

// VAULT_DIR —— owner 真正的库。可以用 REAL_VAULT 指到别处（另一台机器上路径不同）。
const VAULT_DIR = process.env['REAL_VAULT'] ?? join(homedir(), 'Develop/writing/notes');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('vault mirror · a round trip with no edits', () => {
  test.beforeAll(async ({ playwright }) => {
    // 这条 spec 会往库里灌一千多条笔记，下一次 reset 的 TRUNCATE 因此比默认的 30s 钩子上限慢。
    // 放宽的是钩子的耐心，判据一个字没动。
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('sync up then sync down returns the same bytes, and a second round changes nothing',
    async ({ playwright }) => {
      test.skip(!existsSync(VAULT_DIR), `no vault at ${VAULT_DIR} — set REAL_VAULT to point at one`);
      // 两轮真 vault（实测单轮 ~17s，一千篇）装不进默认的 30s。同上：放宽的是耐心。
      test.setTimeout(300_000);
      // 一千篇的导入本来就要几十秒，而 Playwright 的 API 默认上限是 10 秒 —— 那个数字属于
      // 驱动器，不属于产品：owner 在界面上点「导入」时浏览器没有这个上限。放宽的是驱动器的
      // 耐心，不是判据（判据一个字没动：字节必须一样）。
      const request = await playwright.request.newContext({ timeout: 300_000 });

      const original = readVault(VAULT_DIR);
      expect(original.length, `${VAULT_DIR} has notes to sync`).toBeGreaterThan(0);
      console.log(`\n── vault: ${original.length} files from ${VAULT_DIR}`);

      const first = await timed('round 1', () => roundTrip(request, original));
      const second = await timed('round 2', () => roundTrip(request, exportedAsVault(first)));

      // **两份报告都先打完再断言**。断言一红就停在那里的话，读的人只拿到两个问题里的
      // 一个答案 —— 而「一次往返改了什么」和「第二次还改不改」要放在一起才读得懂。
      const once = diff(original, first);
      const twice = diff(exportedAsVault(first), second);
      report('一次往返（原样返回）', once);
      report('二次往返（收敛）', twice);

      // ① owner 问的那一句。判的是 corpus 那三个 genre（raw / wiki / subjectivity）——
      // 这一趟真 vault 上是 1078 个文件里的 1077 个。
      //
      // 排除的两类**各自有名有姓**，不是「差不多就行」：
      //   · `writings/` —— 走另一条导出路径（domain entity + 它自己的 mapper），
      //     同样丢 `langs` / `aliases-zh` 并凭空加 `slug` / `cover_hue`。F-L-70，未修。
      //   · `.obsidian/` —— 导入时被采集（appearance + snippets CSS），导出不写回。F-L-71，未修。
      //   · `templates/` —— **丢掉是对的**：它不是 genre 目录，本来就不该进语料。
      // 名单里多一项都要在这里写清楚理由；它不是用来消化新出现的差异的。
      expect(
        summarise(withoutKnownGaps(once)),
        'sync up then down with no edits must return the vault byte-for-byte',
      ).toEqual({ changed: 0, missing: 0, added: 0 });

      // ② 收敛。这一条**不设任何例外**：哪怕某一类第一轮会被改写，第二轮也必须是不动点 ——
      // 不收敛意味着每一次同步都产生 diff，永远。
      expect(
        summarise(twice),
        'a second round trip must be a fixed point — otherwise every sync produces a diff forever',
      ).toEqual({ changed: 0, missing: 0, added: 0 });

      await request.dispose();
    });
});

// ─── 驱动 ────────────────────────────────────────────────────────────────────────────────

// timed —— 顺手把耗时说出来。一千篇往返要多久是 owner 会问的下一个问题，
// 而它只有在真跑的时候才知道。
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const out = await fn();
  console.log(`── ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return out;
}

// roundTrip —— 传上去，导下来。导出的 zip 内容以 genre-relative 路径为键，跟 vault 内相对路径对齐。
async function roundTrip(
  request: APIRequestContext, files: VaultFile[],
): Promise<Record<string, string>> {
  await uploadVault(request, OWNER, files, { authoritative: true });
  const zip = fflate.unzipSync(new Uint8Array(await downloadExport(request, OWNER)));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(zip)) {
    if (!k.endsWith('/')) out[k] = new TextDecoder().decode(v);
  }
  return out;
}

// 导出的 zip 键**本来就是 vault 内相对路径**（`raw/cognitive-science/cognitive-science.md`），
// 没有额外的 vault 前缀 —— 所以两边直接按键比。
//
// ⚠️ 这条第一版在这里剥了一层前缀（照抄 sync-j-export 的 `stripVaultPrefix`），于是把 **genre
// 目录**剥掉了：报出来是「1082 missing · 1052 added · 0 changed」，看起来像产品把整个库搬了家。
// 真相是驱动器在自说自话。新守卫第一次红，先怀疑守卫（[[read-the-failure-before-theorising]]）。
function exportedAsVault(exported: Record<string, string>): VaultFile[] {
  return Object.entries(exported).map(([rel, body]) => ({ rel, body }));
}

// ─── 读真 vault ──────────────────────────────────────────────────────────────────────────

// readVault —— 按**产品自己那条路**筛（use-obsidian.ts 的 syncableVaultFiles / 服务端
// sync_classify.go）：非隐藏的 .md，加上被采集的 .obsidian 配置。自己另写一套筛法的话，
// 比的就不是产品会同步的那个集合了。
function readVault(root: string): VaultFile[] {
  const out: VaultFile[] = [];
  walk(root, root, out);
  return out;
}

function walk(root: string, dir: string, out: VaultFile[]): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(root, abs);
    if (statSync(abs).isDirectory()) {
      if (!isHiddenSeg(name) || name === '.obsidian') walk(root, abs, out);
      continue;
    }
    if (syncable(rel)) out.push({ rel, body: readFileSync(abs, 'utf8') });
  }
}

function isHiddenSeg(seg: string): boolean {
  return seg === '_templates' || seg.startsWith('.');
}

function syncable(rel: string): boolean {
  const harvested = rel.endsWith('.obsidian/appearance.json')
    || (rel.includes('.obsidian/snippets/') && rel.endsWith('.css'));
  if (harvested) return true;
  return rel.endsWith('.md') && !rel.split('/').some(isHiddenSeg);
}

// ─── 判据 ────────────────────────────────────────────────────────────────────────────────

interface Diff {
  changed: { rel: string; before: string; after: string }[];
  missing: string[];
  added: string[];
}

function diff(before: VaultFile[], after: Record<string, string>): Diff {
  const d: Diff = { changed: [], missing: [], added: [] };
  const seen = new Set<string>();
  for (const f of before) {
    seen.add(f.rel);
    const got = after[f.rel];
    if (got === undefined) d.missing.push(f.rel);
    else if (got !== f.body) d.changed.push({ rel: f.rel, before: f.body, after: got });
  }
  d.added = Object.keys(after).filter((k) => !seen.has(k));
  return d;
}

// KNOWN_GAPS —— 还没修的那两类，各自指着一条 finding。三条以外的任何差异都要红。
const KNOWN_GAPS = [
  'writings/',   // F-L-70：writings 走另一条导出路径，还没接上保真机制
  '.obsidian/',  // F-L-71：采集进来的 Obsidian 配置，导出不写回
  'templates/',  // 不是 genre 目录 —— 丢掉是**对的**，列在这里只是为了不被算成差异
];

function withoutKnownGaps(d: Diff): Diff {
  const open = (p: string): boolean => !KNOWN_GAPS.some((g) => p.startsWith(g));
  return {
    changed: d.changed.filter((c) => open(c.rel)),
    missing: d.missing.filter(open),
    added: d.added.filter(open),
  };
}

function summarise(d: Diff): { changed: number; missing: number; added: number } {
  return { changed: d.changed.length, missing: d.missing.length, added: d.added.length };
}

// report —— 红的时候要能**直接动手**：数字说不出哪一行变了。打头几个的首个差异行。
// 一个只说「不相等」的断言，读的人下一步只能自己再跑一遍去查（[[read-the-failure-before-theorising]]）。
function report(label: string, d: Diff): void {
  if (d.changed.length + d.missing.length + d.added.length === 0) return;
  const lines = [`\n── ${label}: ${d.changed.length} changed · ${d.missing.length} missing · ${d.added.length} added`];
  // 每个 genre 各摊开一个样本。只摊第一个的话，raw 排在前面就把 wiki 的形状盖住了 ——
  // 而两者变的东西完全不同（一个是叠加，一个是 frontmatter 重排），当成一件事就会漏掉一半。
  for (const genre of ['raw', 'wiki', 'subjectivity', 'writings']) {
    const head = d.changed.find((c) => c.rel.startsWith(`${genre}/`));
    if (head === undefined) continue;
    lines.push(`  ~ [${genre}] ${head.rel} — 头 12 行两边并排:`);
    lines.push(`    IN :\n${indent(head.before)}`);
    lines.push(`    OUT:\n${indent(head.after)}`);
  }
  // missing / added **全列出来**，不截断：它们是路径级的事实，条数本来就不多，而
  // 「26 missing」这个数字本身没法让任何人动手。changed 才需要截断（可能上千条）。
  for (const m of d.missing) lines.push(`  - ${m} (went in, did not come back)`);
  for (const a of d.added) lines.push(`  + ${a} (came back, never went in)`);
  console.log(lines.join('\n'));
}

// indent —— 头 12 行（frontmatter 块通常在这里面）。只给一行 delta 的话，读的人下一步只能
// 自己再跑一遍去看上下文。
function indent(s: string): string {
  return s.split('\n').slice(0, 12).map((l) => `      ${JSON.stringify(l)}`).join('\n');
}

