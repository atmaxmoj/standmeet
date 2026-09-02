// role-tools-editable.spec.ts — F-D-9. A role's **tool grants** (skills / external MCP
// servers) must remain editable after the role already exists.
//
// The top of /admin/roles says a role bundles "a set of skills, and which MCP servers it
// may call", and the api·mcp panel, right after registering a server, also says "then
// attach it to a role under codes". But both of these lists **can only be set once,
// inside the "+ NEW ROLE" dialog**: the card is left with only two read-only lines,
// `SKILLS 0` / `MCP 0 servers` (the roles/ directory only has six config components:
// Corpus / Description / Dock / Ghost / Provider / Waypoints). And `invited` and `public`
// were created by the seeder, **which never went through that dialog at all** — meaning
// the default role every blank code goes through can never get a single external MCP
// server.
//
// This is the other two lists sharing the same bug as F-A-11: that one had the corpus
// grant list locking up after creation, fixed by RoleCorpusConfig (inline edit on the
// card -> a full PUT). The backend side was never missing the capability:
// usecase/roles.go's Update has always accepted corpus_uris + skill_ids +
// mcp_server_ids, with syncRoleJoins syncing all three join tables together. What's
// missing is only the face for it — so tool-roles-mcp.spec.ts, which drives the API
// directly, is all green, while the owner has no such switch in front of them.
//
// This guard drives the owner's real interface, and what it asserts is "it remembers
// after the edit": reload the page and check the card again.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'roletools@example.com',
  password: 'role-tools-pass-123',
  handle: 'roletools',
  fullName: 'Role Tools Owner',
};

const SERVER = 'attachable';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// invitedCard — the built-in `invited` card. It's the role every blank code goes through,
// and the one that most needs to be able to attach tools.
function invitedCard(page: Page) {
  return page.getByTestId('role-row-invited');
}

test.describe('F-D-9 · a role’s tool grants stay editable after it exists', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance can take ~48s under load, while the hook defaults to 30s
    await initOwner(playwright);
  });

  test('an existing role can be given a registered MCP server, and it sticks',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'roles');
      await adminPage.waitForURL('**/admin/roles', { timeout: 10_000 });

      // Red is right here: this control doesn't exist on the card at all — both lists
      // lock up after creation.
      const chip = invitedCard(adminPage).getByTestId(`role-multi-${SERVER}`);
      await expect(chip, 'the invited card offers its MCP servers as an editable list')
        .toBeVisible({ timeout: 5_000 });

      await chip.click();
      // Wait for that write to **actually come back** before reloading: reloading right
      // away would cut off a PUT still in flight, so "it didn't save" and "we didn't wait
      // for it to finish saving" would look identical on screen
      // ([[write-with-no-receipt]]).
      const saved = adminPage.waitForResponse(
        (r) => /\/api\/admin\/roles\//.test(r.url()) && r.request().method() === 'PUT',
        { timeout: 10_000 },
      );
      await invitedCard(adminPage).getByTestId('role-tools-save').click();
      const res = await saved;
      expect(res.status(), '保存本身必须成功,不然下面断的是另一件事').toBeLessThan(400);

      // Reload and check again: what's being asserted is "it remembers", not "it's
      // clickable". That cell was already on the card (the read-only `N servers`), so
      // this reuses it rather than inventing a new testid.
      await adminPage.reload();
      await expect(invitedCard(adminPage).getByTestId('role-meta-mcp'),
        'the card reports the server it was just given').toHaveText('1 servers');
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'role-tools-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'role tools intro.', title: 'Role Tools Intro',
  });
  // A registered external MCP server — whether it's **reachable** is irrelevant to this
  // guard; what's asserted here is whether the grant can be edited.
  const res = await request.post(`${process.env['BACKEND_URL'] ?? 'http://localhost:8000'}/api/admin/mcp-servers`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name: SERVER, url: 'https://mcp.example.com/mcp', auth_header_name: '', auth_header_value: '' },
  });
  if (!res.ok()) throw new Error(`register mcp server failed: ${res.status()}`);
  await request.dispose();
}
