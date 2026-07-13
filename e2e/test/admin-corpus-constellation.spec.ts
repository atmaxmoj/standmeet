// admin-corpus-constellation.spec.ts —— the TopBar's corpus constellation (replaced the
// old text ticker). GET /api/admin/stats/graph derives each note's link degree from
// note_refs; nodes render sized by degree (more links → bigger — the Obsidian-graph read).
//   1. the endpoint returns degree-desc nodes, each {id, title, genre, degree}, and a note
//      that is linked has degree ≥ 1;
//   2. the constellation renders in the TopBar and shows a real hub note.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'alice@example.com', password: 'test-password-1234',
  handle: 'alice', fullName: 'Alice',
};

interface Graph { nodes: { id: string; title: string; genre: string; degree: number }[] }

async function seedLinkedCorpus(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'graph-seed');
  const sid = await initMCP(request, token);
  // Hub Note first, then a note whose body [[Hub Note]] links it → RebuildNoteRefs writes
  // a note_ref, so Hub Note's degree ≥ 1.
  await seedWiki(request, token, sid, { title: 'Hub Note', body: 'The hub of the graph.' });
  await seedWiki(request, token, sid, { title: 'Leaf Note', body: 'See [[Hub Note]] for context.' });
  await request.dispose();
}

async function getGraph(authed: APIRequestContext): Promise<Graph> {
  const res = await authed.get(`${BACKEND}/api/admin/stats/graph?limit=18`);
  expect(res.status(), 'graph endpoint 200').toBe(200);
  return await res.json() as Graph;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · corpus constellation (link-degree graph)', () => {
  test.beforeAll(async ({ playwright }) => { await seedLinkedCorpus(playwright); });

  test('GET /api/admin/stats/graph returns degree-desc nodes; a linked note has degree ≥ 1',
    async ({ adminPage }) => {
      const g = await getGraph(adminPage.request);
      expect(g.nodes.length, 'has nodes').toBeGreaterThan(0);
      g.nodes.forEach((n) => {
        expect(n.id, 'node id').toBeTruthy();
        expect(n.title, 'node title').toBeTruthy();
        expect(typeof n.degree, 'degree is a number').toBe('number');
      });
      // degree-descending order.
      const degs = g.nodes.map((n) => n.degree);
      for (let i = 1; i < degs.length; i++) {
        expect(degs[i - 1], 'degree desc').toBeGreaterThanOrEqual(degs[i] ?? 0);
      }
      // the linked hub is present with a real degree.
      const hub = g.nodes.find((n) => n.title === 'Hub Note');
      expect(hub, 'Hub Note present').toBeTruthy();
      expect(hub?.degree ?? 0, 'Hub Note has ≥ 1 link').toBeGreaterThanOrEqual(1);
    });

  test('constellation renders in the TopBar and shows a real hub node',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      const strip = adminPage.getByTestId('corpus-constellation');
      await expect(strip).toBeVisible();
      await expect(strip).not.toContainText(/no links yet/i);
      await expect(strip).toContainText('Hub Note');
    });
});
