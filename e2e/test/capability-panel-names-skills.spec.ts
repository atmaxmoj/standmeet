// capability-panel-names-skills.spec.ts —— every row in the capabilities panel must state
// **what it is**.
//
// For an owner-authored skill, the capability id is a UUID. The panel renders `row.id`, so
// built-in capabilities look fine (their id is already human words like `mail.send`), but an
// owner's skill renders as `8e8a1beb-6fab-4662-8674-bbae555d85cd`. Right next to it sit a
// toggle and an ✕ — the owner has to decide whether to disable or delete it based on a name
// they can't recognize. The same skill has a name on /admin/skills; the two views don't line
// up.
//
// The existing capability-panel-lists-all test goes through HTTP (listCapabilities) and
// **never opens a browser**, so it knows nothing about "what this row actually looks like" —
// the same pattern already showed up once in F-C-12. This test only looks at the GUI.

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'cap-names@example.com', password: 'correct-horse-battery-staple',
  handle: 'capnames', fullName: 'Cap Names Owner',
};

const SKILL = 'audit-namer';

// UUID_LABEL — a bare UUID appearing in a row's visible text means this row has no name.
const UUID_LABEL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('capabilities · every row says what it is', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'cap-names-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'skill_create', {
      name: SKILL, description: 'names its own row', prompt: 'do the thing',
    });
    await request.dispose();
  });

  test('an owner skill shows its name, and no row wears a bare UUID', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'connectors');
    const panel = adminPage.getByTestId('capabilities-panel');
    await expect(panel).toBeVisible();

    await expect(
      panel,
      'the owner skill must be identifiable by name — its toggle and its ✕ act on it',
    ).toContainText(SKILL);

    // Whole-class assertion: no row may be left with only an id. Without this, the next
    // nameless kind would slip through the same way.
    const labels = await panel.locator('[data-testid^="capability-row-"]').allInnerTexts();
    expect(labels.length, 'the panel actually rendered rows').toBeGreaterThan(0);
    expect(
      labels.filter((text) => UUID_LABEL.test(text)),
      'no capability row may be labelled with a bare UUID',
    ).toHaveLength(0);
  });
});
