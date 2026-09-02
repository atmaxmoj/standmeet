// corpus-retrieval-excludes-raw.spec.ts — pre-migration gap-fill (🟡#1).
//
// raw never enters visitor retrieval — today only iam-role-raw-deny proves this, and only via
// the **LLM citation** path (cites==0). What's missing is a direct assertion against the lister
// (corpus_search): even if the role **greedily** grants raw://** too, corpus_search still must
// not return raw. After the structural migration, raw stays in its own inbox table and the genre
// dimension moves into the query — if the genre filter has a gap, raw could accidentally get
// swept into retrieval. This case pins down raw's exclusion at the lister layer, independent of
// the LLM path.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
// Use the shared one — this file used to have its own copy, so a single change to
// corpus_search's wire format broke four places at once, and the fixture absorbed none of it.
import { search } from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'excluderaw@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'excluderaw',
  fullName: 'Exclude Raw Owner',
};
const CODE = 'EXCLUDERAW-1';
const RAW_KEY = 'rawonlyqx';
const WIKI_KEY = 'wikionlyqx';
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('retrieval excludes raw even when the role greedily grants raw://**', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'exclude-raw-seed');
    const sid = await initMCP(request, token);
    // A raw entry (never promoted) + a wiki entry — each with a unique keyword.
    await callTool(request, token, sid, 'corpus.create',
      { genre: 'raw', body: `private raw thought about ${RAW_KEY}`,
        source: 'mcp:e2e', tags: [] });
    await seedWiki(request, token, sid, { title: 'Public Wiki', body: `note about ${WIKI_KEY}` });
    // GREEDY role: grants raw://** (which is hardcode-denied) + wiki://**.
    const role = await createRole(request, csrf, {
      name: 'greedy-raw-role', description: 'grants raw://** + wiki://**',
      corpus_uris: ['raw://**', 'wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'greedy', assumed_role_id: role.id });
    await request.dispose();
  });

  test('corpus_search never returns a raw entry (positive control: it does find the wiki)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });

      // The raw keyword surfaces nothing — raw is not scanned by the lister.
      const rawHits = await search(request, sess, RAW_KEY);
      expect(rawHits.length, 'raw entry never appears in corpus_search, despite raw://** granted')
        .toBe(0);

      // Positive control: the wiki keyword DOES surface (proves search works, raw is the exclusion).
      const wikiHits = await search(request, sess, WIKI_KEY);
      expect(wikiHits.some((h) => h.title === 'Public Wiki'), 'the wiki entry is found').toBe(true);
      await request.dispose();
    });
});

