// corpus-delete-does-not-look-safe.spec.ts -- UX-32: a destructive action must not look
// identical to a safe action on hover.
//
// Caught during a design review: each raw row has three actions -- promote / edit /
// delete -- and **all three converge to the same vermillion on hover**
// (`RawRowList.tsx:183/191/199` are all `hover:...-(--color-accent)`). So "promote into
// wiki", "edit", and "permanently delete" give identical feedback the moment the mouse
// stops, and hover is the last chance to tell them apart before the click. The resting
// state is worse: delete uses `--color-faint`, the palest of the three.
//
// Asserts on **the computed color**, not the class name: a class name can be rewritten to
// slip past this check, but what the reader sees is pixels.
// The two assertions point in opposite directions --
//   1. delete's hover color != edit's hover color (danger must be recognizable);
//   2. delete's color really does **change** on hover (otherwise "the two differ" could
//      be satisfied by "delete has no hover feedback at all", which is a different kind
//      of broken).

import { test, expect } from '@/fixtures/test';
import type { Locator } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

async function colorOf(el: Locator): Promise<string> {
  return el.evaluate((n) => getComputedStyle(n).color);
}

test.describe('corpus · a destructive row action must not read as a safe one', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'delete-look-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'corpus.create', {
      genre: 'raw', body: 'a raw thought to delete', source: 'mcp:e2e', tags: [],
    });
    await request.dispose();
  });

  test('hovering delete does not land on the same colour as hovering edit',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000);
      await page.getByTestId('admin-nav-raw').click();
      await page.waitForURL('**/admin/raw**');

      const del = page.locator('[data-testid^="raw-delete-"]').first();
      const edit = page.locator('[data-testid^="raw-edit-"]').first();
      await expect(del).toBeVisible({ timeout: 30_000 });
      await expect(edit).toBeVisible({ timeout: 30_000 });

      const delResting = await colorOf(del);

      await del.hover();
      const delHover = await colorOf(del);
      await edit.hover();
      const editHover = await colorOf(edit);

      // 2) delete really does give hover feedback -- otherwise the check below could be
      // satisfied by "it just doesn't respond at all".
      expect(delHover, 'delete must react to hover at all').not.toBe(delResting);
      // 1) And that feedback must be distinguishable from a safe action's.
      expect(delHover, 'destructive hover must not equal the safe action hover').not.toBe(editHover);
    });
});
