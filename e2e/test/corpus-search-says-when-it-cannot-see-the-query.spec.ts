// corpus-search-says-when-it-cannot-see-the-query.spec.ts —— 空手不许什么都不说。
//
// 缺陷 F-S-2：`corpus_search` 空手时返回一个裸 `[]`，而那个值同时表示两件事 ——
// 「语料里确实没有」和「这条索引表示不了你的查询」。agent 读到的是前者，于是那半个问题
// 静默地没被回答。prod 实证（`corpus-search-cjk-not-silent.spec.ts` 记着）：
// `递归收敛` 回 `[]`，同一轮的英文查询回 7883 字节，答案照常生成，界面上完全看不出来。
//
// **判据不是「它知道你的查询不可索引」** —— 那句话说不出口：Meili 的响应根本不告诉我们
// 这件事，写进去就是编的（[[names-that-lie]]）。判据是那句**永远为真**的：
// 这次是空的，而这条索引依赖分词，空手不等于没有；要确定就走 never-miss 那条（corpus_grep）。
//
// 为什么不留在工具说明里就够：说明是 agent **选工具那一刻**读的，note 是它**拿到空手
// 那一刻**读的 —— 而那才是需要改主意的时刻。
//
// 判据成对，两边都得能红：
//   - 有命中 → **不许**带 note（否则实现方给所有回执都贴上那句话就绿了，那比现在更糟）
//   - 空手   → 必须带 note，且点得出 corpus_grep

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

  // ── 正对照先跑：有命中时**不带** note ──────────────────────────────
  //
  // 只写"空手带 note"那半边的话，给每份回执都贴上那句话也能绿 —— 那会把一句
  // 该在特定时刻出现的提醒变成背景噪音，agent 学会无视它。
  test('a query that matches carries hits and no note',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code, visitor_name: 'Visitor Val',
      });
      const res = await searchResult(request, sess, 'feedback loops');
      expect(res.hits.map((h) => h.title)).toContain(NOTE_TITLE);
      expect(res.note, '有命中还贴提醒 = 把它变成噪音').toBeUndefined();
    });

  // ── 有了正对照，空手那半边才有意义 ────────────────────────────────
  test('an empty result says the index is tokenization-dependent and names corpus_grep',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code, visitor_name: 'Visitor Vic',
      });
      const res = await searchResult(request, sess, 'submarine hydraulics');
      expect(res.hits).toHaveLength(0);
      expect(res.note, '空手回了个裸数组 —— agent 读到的是"没有"').toBeDefined();
      // 两件事都要说到：空不等于没有，以及接下来去哪儿。
      expect(res.note!).toMatch(/does NOT mean the corpus lacks/i);
      expect(res.note!).toMatch(/corpus_grep/);
    });
});
