// corpus-search-says-when-it-cannot-see-the-query.spec.ts — an empty result is not
// allowed to say nothing.
//
// Defect F-S-2: `corpus_search` returns a bare `[]` on an empty result, and that value
// means two different things at once — "the corpus genuinely doesn't have this" and
// "this index can't represent your query". The agent reads the former, and that other
// half of the question goes silently unanswered. Verified in prod (recorded in
// `corpus-search-cjk-not-silent.spec.ts`): `递归收敛` returned `[]`, while an English
// query in the same turn returned 7883 bytes, the answer generated as usual, and nothing
// in the UI showed any sign of it.
//
// **The criterion is not "it knows your query is unindexable"** — that sentence can't
// honestly be said: Meili's response never tells us that at all, so writing it in would
// be fabricated ([[names-that-lie]]). The criterion is the sentence that's **always
// true**: this result happened to be empty, and this index depends on tokenization, so
// empty does not mean absent; to be sure, use the never-miss path instead (corpus_grep).
//
// Why leaving it only in the tool description isn't enough: the description is read by
// the agent **at the moment it picks a tool**; the note is read **at the moment it gets
// an empty result** — and that's the moment it actually needs to reconsider.
//
// The criteria come in a pair, and both sides must be able to go red:
//   - a hit -> **must not** carry a note (otherwise an implementation could stamp that
//     sentence on every receipt and go green, which would be worse than today)
//   - empty -> must carry a note, and it must name corpus_grep

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { issueSession } from '@/fixtures/visitor';
import { searchResult } from '@/fixtures/retrieval';

const OWNER = {
  email: 'searcher@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'searcher',
  fullName: 'Sam Searcher',
};
const NOTE_TITLE = 'Control theory notes';

test.describe('corpus_search · an empty result says why it might be empty', () => {
  let code = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'search-note-spec');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      title: NOTE_TITLE, path: 'cybernetics/control',
      body: 'Feedback loops, observers, and the cost of a slow measurement.',
    });
    code = (await createCode(request, csrf, { code: 'SEARCH-1', label: 'search' })).code;
    await request.dispose();
  });

  // ── run the positive control first: a hit **does not** carry a note ──────────────
  //
  // Testing only the "empty carries a note" half would let stamping that sentence on
  // every receipt go green too — that would turn a warning meant to appear at a
  // specific moment into background noise, and the agent would learn to ignore it.
  test('a query that matches carries hits and no note',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code, visitor_name: 'Visitor Val',
      });
      const res = await searchResult(request, sess, 'feedback loops');
      expect(res.hits.map((h) => h.title)).toContain(NOTE_TITLE);
      expect(res.note, '有命中还贴提醒 = 把它变成噪音').toBeUndefined();
    });

  // ── with the positive control in place, the empty-result half now means something ──
  test('an empty result says the index is tokenization-dependent and names corpus_grep',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code, visitor_name: 'Visitor Vic',
      });
      const res = await searchResult(request, sess, 'submarine hydraulics');
      expect(res.hits).toHaveLength(0);
      expect(res.note, '空手回了个裸数组 —— agent 读到的是"没有"').toBeDefined();
      // Both things must be said: empty does not mean absent, and where to go next.
      expect(res.note!).toMatch(/does NOT mean the corpus lacks/i);
      expect(res.note!).toMatch(/corpus_grep/);
    });
});
