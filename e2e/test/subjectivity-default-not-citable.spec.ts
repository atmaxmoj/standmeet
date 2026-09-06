// subjectivity-default-not-citable.spec.ts —— #9: a subjectivity entry defaults to NOT citable
// (show_as_source = false) when the field is omitted, unlike the other genres which default to
// citable. Subjectivity is the owner's meta/persona voice, not a referenceable source. An explicit
// show_as_source:true still opts it in.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'subjcit@example.com', password: 'correct-horse-battery-staple',
  handle: 'subjcit', fullName: 'Subj Cite Owner',
};

let token = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('subjectivity defaults to not-citable', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('omitting show_as_source makes a subjectivity entry not citable; explicit true opts in',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // corpus.create (what the panel uses) — the path this change fixed: absent → not citable.
      const def = await callTool<{ id: string }>(request, token, sid, 'corpus.create',
        { genre: 'subjectivity', title: 'Default subj', body: 'my meta voice', tags: [] });
      const defRead = await callTool<{ show_as_source: boolean }>(request, token, sid, 'corpus.get',
        { genre: 'subjectivity', id: def.id });
      expect(defRead.show_as_source, 'subjectivity via corpus.create defaults to NOT citable').toBe(false);

      // Explicit opt-in still works.
      const optIn = await callTool<{ id: string }>(request, token, sid, 'corpus.create',
        { genre: 'subjectivity', title: 'Opt-in subj', body: 'explicitly citable', tags: [], show_as_source: true });
      const optRead = await callTool<{ show_as_source: boolean }>(request, token, sid, 'corpus.get',
        { genre: 'subjectivity', id: optIn.id });
      expect(optRead.show_as_source, 'an explicit true still opts subjectivity in').toBe(true);

      // The dedicated subjectivity_write tool defaults private too (it returns subjectivity_id).
      const viaTool = await callTool<{ subjectivity_id: string }>(request, token, sid, 'subjectivity_write',
        { title: 'Via tool', body: 'private by default', tags: [] });
      const toolRead = await callTool<{ show_as_source: boolean }>(request, token, sid, 'corpus.get',
        { genre: 'subjectivity', id: viaTool.subjectivity_id });
      expect(toolRead.show_as_source, 'subjectivity_write defaults to NOT citable too').toBe(false);
      await request.dispose();
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
  token = await createAPIToken(request, csrf, 'subjcit-seed');
  sid = await initMCP(request, token);
  await request.dispose();
}
