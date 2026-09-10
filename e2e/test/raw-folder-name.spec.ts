// raw-folder-name.spec.ts —— #8: an auto-created raw FOLDER node shows its folder name, not the
// "(untitled)" fallback. When Obsidian syncs raw/software/<note>.md WITHOUT a software/software.md
// folder-note, the sync auto-creates an empty-body container node for "software" (the tolerance
// proven in sync-k missingFolderNotes). That node has no body and no source, so the admin raw card
// rendered it as "(untitled)" and the owner asked, on the live instance, "why is this untitled".
// It now shows the folder name, taken from the node's derived path.
//
// This drives the REAL admin UI (the card in /admin/raw), not the API: the fix is a rendering
// change, so asserting the derived path over the API (as sync-k does) would not catch a card that
// still shows "(untitled)".

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import { claimSyncOwner, syncOwner, type SyncOwner } from '@/fixtures/vault-sync';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER: SyncOwner = syncOwner('rawfolder');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('#8 · an auto-created raw folder node shows its name, not (untitled)', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    // A note under software/ with NO software/software.md → the sync auto-creates an empty-body
    // "software" folder node: the exact shape that rendered as "(untitled)" on the live instance.
    await uploadVault(request, OWNER, [
      { rel: 'raw/software/a-real-note.md', body: makeVaultMD({}, '# a real note\n\nsome content\n') },
    ]);
    await request.dispose();
  });

  test('the empty-body folder node renders "software", not the untitled fallback',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      // The folder node is a tree root; its card shows the folder name via raw-folder-name.
      const folder = adminPage.getByTestId('raw-folder-name').filter({ hasText: 'software' });
      await expect(folder, 'the folder node shows its name "software"').toBeVisible({ timeout: 15_000 });
      // And nothing falls back to "(untitled)": the only empty-body node is that named folder, and
      // the real note (a child, shown on expand) has a lead. Before the fix the folder root WAS the
      // untitled card, so this count would be 1.
      await expect(adminPage.getByTestId('raw-untitled'),
        'no card falls back to (untitled) for a named folder').toHaveCount(0);
    });
});
