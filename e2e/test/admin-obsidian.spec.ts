// admin-obsidian.spec.ts —— /admin/obsidian renders the REAL, functional import/export (F-L-1).
//
// The page used to be a dead mockup: a fake vault path + hardcoded stat cells (mode/notes/size/
// last-sync) + two `<button>`s with no onClick. The old spec asserted those fake cells rendered —
// false confidence. It now renders the shared ObsidianBar (the same working folder-picker +
// export the writings section uses). These guards assert the actions are real, not dead.

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'obsidian@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'obsidian',
  fullName: 'Obsidian Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin obsidian section', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('renders the real ObsidianBar (folder picker), not the dead mockup (F-L-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'obsidian');
      await adminPage.waitForURL('**/admin/obsidian', { timeout: 5_000 });
      // The real, functional component + its vault-folder <input> — the mockup had neither.
      await expect(adminPage.getByTestId('obsidian-bar')).toBeVisible();
      await expect(adminPage.getByTestId('obsidian-vault-input')).toBeAttached();
      // The old fake stat cell is gone (it implied a live-synced vault that never existed).
      await expect(adminPage.getByTestId('vault-stat-mode')).toHaveCount(0);
    });

  test('the export button actually downloads the corpus vault (F-L-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'obsidian');
      await expect(adminPage.getByTestId('obsidian-bar')).toBeVisible();
      // A dead button fires no download; the real one hits GET /obsidian/export → a .zip.
      const download = adminPage.waitForEvent('download', { timeout: 10_000 });
      await adminPage.getByRole('button', { name: /export/i }).click();
      expect((await download).suggestedFilename()).toMatch(/\.zip$/);
    });

  // F-L-7 —— a REAL Obsidian vault is normally a git repo. The picker hands the browser the whole
  // folder, so uploading it verbatim posted thousands of .git objects the server drops on arrival,
  // blowing the multipart part limit: importing a git-backed vault failed outright with
  // "message too large". Every other sync spec posts a synthetic 2-file vault straight to the API,
  // bypassing the client's file selection — which is exactly why this was invisible.
  // This drives the REAL picker with a REAL-shaped vault.
  test('imports a git-backed vault — .git is not uploaded (F-L-7)',
    async ({ adminPage }) => {
      const vault = makeGitBackedVault();
      await gotoAdminSection(adminPage, 'obsidian');
      await expect(adminPage.getByTestId('obsidian-vault-input')).toBeAttached();

      const done = adminPage.waitForResponse(
        (r) => r.url().includes('/obsidian/import') && r.request().method() === 'POST',
        { timeout: 60_000 },
      );
      await adminPage.getByTestId('obsidian-vault-input').setInputFiles(vault);
      const res = await done;

      expect(res.status(), 'a git-backed vault must import, not 400 "message too large"').toBe(200);
      const body: unknown = await res.json();
      const parsed = ImportOutcomeSchema.parse(body);
      expect(parsed.errors, 'the vault imports cleanly').toEqual([]);
      // The real note landed; the ~1200 .git objects never left the browser.
      expect(parsed.created + parsed.updated, 'the vault content is ingested').toBeGreaterThan(0);
    });
});

const ImportOutcomeSchema = z.object({
  created: z.number(), updated: z.number(), skipped: z.number(), errors: z.array(z.string()),
});

// makeGitBackedVault —— a vault shaped like a real one: real notes PLUS a .git directory big enough
// to blow the multipart part limit if it were uploaded (a real vault's .git holds thousands of
// objects). Also carries the .obsidian CSS config, which IS harvested and must still be sent.
function makeGitBackedVault(): string {
  const root = mkdtempSync(join(tmpdir(), 'standmeet-vault-'));
  mkdirSync(join(root, 'raw'), { recursive: true });
  writeFileSync(join(root, 'raw', 'a-real-note.md'), '---\ntags: [x]\n---\n\nreal vault content.\n');
  mkdirSync(join(root, '.obsidian', 'snippets'), { recursive: true });
  writeFileSync(join(root, '.obsidian', 'snippets', 'custom.css'), '.x{color:red}');
  // the part-count bomb: what a version-controlled vault actually carries.
  const objects = join(root, '.git', 'objects', 'ab');
  mkdirSync(objects, { recursive: true });
  for (let i = 0; i < 1200; i++) writeFileSync(join(objects, `obj${i}`), 'x');
  return root;
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
