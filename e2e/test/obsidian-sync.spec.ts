// obsidian-sync.spec.ts — full-chain e2e for the Obsidian vault import/export
// bidirectional sync.
//
// Business story:
//   1. The owner clicks "import from Obsidian" on admin /writings, picks a vault
//      directory → .md files carrying `publish: true` go into the database; ones
//      without publish are skipped.
//   2. round-trip: import → export → unzip → compare frontmatter + body shape against
//      the original (lossless).
//   3. an image attachment is uploaded together with its .md → MinIO receives the
//      bytes → on export the blob is written into the zip's attachments/ → content ==
//      the original PNG.
//   4. idempotency: importing the same vault again → everything skipped (updated_at ==
//      imported_at + a buffer, no "web edited").
//   5. UI: the two buttons on admin /writings render + show status "X new · Y updated".

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
      // the ![[pixel.png]] inside the body has already been rewritten to
      // standmeet-asset:<uuid>
      expect(p?.body_md).toMatch(
        /standmeet-asset:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
      expect(p?.body_md).not.toContain('![[pixel.png]]');

      // export → the matching bytes can be found under attachments/ in the zip
      const zip = await downloadExport(request, OWNER);
      const entries = unzip(zip);
      const attachKeys = Object.keys(entries).filter((k) => k.startsWith('attachments/'));
      expect(attachKeys.length).toBeGreaterThan(0);
      const firstAttachBytes = entries[attachKeys[0]!];
      if (!firstAttachBytes) throw new Error('missing attachment bytes');
      expect(firstAttachBytes.length).toBe(PNG_1X1.length);
      expect(Buffer.compare(Buffer.from(firstAttachBytes), Buffer.from(PNG_1X1))).toBe(0);

      // the writing's .md can be found in the zip, and its body references
      // attachments/<id>.png
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

      // The second import: source_path hits the same row, and **the content hasn't
      // changed a single character → it must not be rewritten** (F-L-64).
      //
      // These three lines used to assert `updated: 1` ("goes through SaveWriting and
      // overwrites"), the exact opposite of this test's own name, "all skipped" — it
      // was pinning down a defect: the writings path had no "did anything actually
      // change" comparison, so every import advanced every writing's `updated_at`
      // regardless. vault-sync's check 4 says "a second import is a no-op, content is
      // preserved rather than rewritten." Now the name, the judgment criterion, and the
      // product all agree.
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
