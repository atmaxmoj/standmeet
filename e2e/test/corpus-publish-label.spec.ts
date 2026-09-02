// corpus-publish-label.spec.ts — the switch that decides "is this entry public" must be
// labelled as a publish switch.
//
// The entry editor has no control actually named publish. The checkbox that writes
// `published` lives inside SEOEditor, and its label reads "include in sitemap.xml (let
// search engines find this)" — that names a **consequence**, not the **concept**.
// Unchecking it isn't "keep Google from finding this", it's taking this public page down
// entirely, silently dropping it from the homepage's pin list along the way
// (page-corpus-pinning's invariant).
//
// The owner has already confirmed this is **one** concept (SEO rides along with
// published), and also confirmed it has nothing to do with retrieval — retrieval is
// governed by the role's corpus glob + citable. So this isn't a schema problem, it's a
// labelling problem.
//
// What's asserted is that the label names the concept, not what it looks like.

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'publabel@example.com', password: 'correct-horse-battery-staple',
  handle: 'publabel', fullName: 'Pub Label Owner',
};

const TITLE = 'Publish Label Probe';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('corpus · the publish switch is labelled as a publish switch', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'pub-label-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, { title: TITLE, body: 'a body worth publishing' });
    await request.dispose();
  });

  test('the control that writes `published` names publishing, not the sitemap',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      await adminPage.getByText('edit', { exact: false }).first().click();

      // The testid carries the entry id (`wiki-<uuid>-seo-indexed`), so select by suffix.
      const box = adminPage.locator('[data-testid$="-seo-indexed"]').first();
      await expect(box).toBeVisible();
      // The label is the <label> wrapping the checkbox.
      const label = (await box.locator('xpath=ancestor::label[1]').innerText()).toLowerCase();

      expect(label, 'the switch must name what it actually decides: whether this is public')
        .toMatch(/publish|public/);
      // Mentioning only the sitemap passes off a consequence as the concept —
      // unchecking it takes down the whole public page.
      expect(
        label.includes('sitemap') && !/publish|public/.test(label),
        'the label may mention the sitemap, but not instead of publishing',
      ).toBe(false);
    });
});
