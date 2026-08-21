// obsidian-sync.spec.ts —— Obsidian vault import/export 双向 sync 全链 e2e。
//
// 业务故事：
//   1. owner 在 admin /writings 点 "import from Obsidian"，选 vault 目录 → 带
//      `publish: true` 的 .md 进库；不带 publish 的跳过。
//   2. round-trip: import → export → 解 zip → 比对 frontmatter + body 形态
//      跟最初一致（lossless）。
//   3. image attachment 跟 .md 一起上传 → MinIO 收到 bytes → export 时把
//      blob 写进 zip 的 attachments/ → 内容 == 原始 PNG。
//   4. idempotency: 再次 import 同 vault → 全部 skipped（updated_at ==
//      imported_at + buffer，没"web edited"）。
//   5. UI: admin /writings 上的两个 button 渲出 + 状态 "X new · Y updated"。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';
import * as fflate from 'fflate';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import {
  PNG_1X1, downloadExport, listAdminWritings, makeVaultMD, uploadVault,
  type VaultFile,
} from '@/fixtures/obsidian';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('obsidian: import + publish gate', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('publish: true 的进库，publish 缺失的跳过',
    async ({ request }) => {
      const files: VaultFile[] = [
        {
          rel: 'writing/published-writing.md',
          body: makeVaultMD({
            title: 'Published Writing', slug: 'published-writing',
            tags: ['essay'], publish: true,
            cover_hue: 'amber', cover_headline: 'cover.',
          }, 'Body of the published writing.'),
        },
        {
          rel: 'writing/draft-writing.md',
          body: makeVaultMD({
            title: 'Draft Writing', slug: 'draft-writing',
            tags: ['essay'],
          }, 'A draft that should be skipped.'),
        },
      ];
      const result = await uploadVault(request, OWNER, files);
      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors).toEqual([]);

      const writings = await listAdminWritings(request, OWNER);
      const slugs = writings.map((p) => p.slug);
      expect(slugs).toContain('published-writing');
      expect(slugs).not.toContain('draft-writing');
      const pub = writings.find((p) => p.slug === 'published-writing');
      expect(pub?.title).toBe('Published Writing');
      expect(pub?.tags).toEqual(['essay']);
      expect(pub?.published).toBe(true);
      expect(pub?.cover_hue).toBe('amber');
      expect(pub?.cover_headline).toBe('cover.');
    });
});

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('obsidian: image attachment round-trip', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('vault 里 .md 里 ![[pixel.png]] + attachment pixel.png → MinIO 存 + body rewrite + export 拿回 bytes',
    async ({ request }) => {
      const files: VaultFile[] = [
        {
          rel: 'writing/with-image.md',
          body: makeVaultMD({
            title: 'Writing With Image', slug: 'writing-with-image',
            tags: ['image'], publish: true,
          }, 'Below is an image:\n\n![[pixel.png]]\n\nAnd then more text.'),
        },
        { rel: 'writing/attachments/pixel.png', body: PNG_1X1 },
      ];
      const result = await uploadVault(request, OWNER, files);
      expect(result.created).toBe(1);
      expect(result.errors).toEqual([]);

      const writings = await listAdminWritings(request, OWNER);
      const p = writings.find((x) => x.slug === 'writing-with-image');
      expect(p).toBeTruthy();
      // body 里 ![[pixel.png]] 已经被 rewrite 成 standmeet-asset:<uuid>
      expect(p?.body_md).toMatch(
        /standmeet-asset:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
      expect(p?.body_md).not.toContain('![[pixel.png]]');

      // export → 在 zip 的 attachments/ 里能找到对应 bytes
      const zip = await downloadExport(request, OWNER);
      const entries = unzip(zip);
      const attachKeys = Object.keys(entries).filter((k) => k.startsWith('attachments/'));
      expect(attachKeys.length).toBeGreaterThan(0);
      const firstAttachBytes = entries[attachKeys[0]!];
      if (!firstAttachBytes) throw new Error('missing attachment bytes');
      expect(firstAttachBytes.length).toBe(PNG_1X1.length);
      expect(Buffer.compare(Buffer.from(firstAttachBytes), Buffer.from(PNG_1X1))).toBe(0);

      // writing 的 .md 在 zip 里能找到，且 body 引用 attachments/<id>.png
      const mdContent = entries['writings/writing-with-image.md'];
      if (!mdContent) throw new Error('writing .md missing from export zip');
      const mdText = new TextDecoder().decode(mdContent);
      expect(mdText).toContain('attachments/');
      expect(mdText).toContain('title: Writing With Image');
    });
});

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('obsidian: re-import idempotency', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('同 vault 第二次 import → 全部 skipped (updated_at == imported_at)',
    async ({ request }) => {
      const files: VaultFile[] = [
        {
          rel: 'writing/idempotent.md',
          body: makeVaultMD({
            title: 'Idempotent', slug: 'idempotent',
            tags: [], publish: true,
          }, 'Same content twice.'),
        },
      ];
      const first = await uploadVault(request, OWNER, files);
      expect(first.created).toBe(1);
      expect(first.skipped).toBe(0);

      // 第二次 import：source_path 撞上同一行，而**内容一字未变 → 不重写**（F-L-64）。
      //
      // 这三句以前断的是 `updated: 1`（"走 SaveWriting 覆盖"），跟这条用例自己的名字
      // 「全部 skipped」正好相反 —— 它钉住的是一个缺陷：writings 这条路没有「有没有变」
      // 的比较，于是每导一次全部 writing 的 `updated_at` 就往前跳一次。vault-sync 的
      // check 4 说的是「第二次导入是空操作，内容被保留而不是被重写」。现在名字、判据、
      // 产品三者对上了。
      const second = await uploadVault(request, OWNER, files);
      expect(second.created).toBe(0);
      expect(second.updated, '一字未变就不重写').toBe(0);
      expect(second.skipped, '认到了同一行、什么都没改 → unchanged').toBe(1);
    });
});

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('obsidian: UI buttons', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('admin /writings 渲出 import + export 两个 button',
    async ({ adminPage }) => {
      await openAdminWritings(adminPage);
      await expect(adminPage.getByTestId('obsidian-bar')).toBeVisible();
      await expect(
        adminPage.getByRole('button', { name: /export to obsidian/i }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole('button', { name: /import from obsidian/i }),
      ).toBeVisible();
    });
});

async function openAdminWritings(page: Page): Promise<void> {
  await gotoAdminSection(page, 'writings');
  await page.waitForURL('**/admin/writings');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

function unzip(buf: Buffer): Record<string, Uint8Array> {
  return fflate.unzipSync(new Uint8Array(buf));
}
