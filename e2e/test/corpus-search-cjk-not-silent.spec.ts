// corpus-search-cjk-not-silent.spec.ts —— F-S-2：中文查询在装着中文的语料上返回空手，而且
// 那个空手不说明任何事情。
//
// 怎么撞上的：prod 上问「语料里关于「递归收敛」是怎么说的？」，agent 一轮里并行发了
// `递归收敛` 和 `recursive convergence`。补上 call_id 之后（F-S-1）日志把它们分开了：
//   call_00… query="递归收敛"              result_bytes:2      ← []
//   call_01… query="recursive convergence" result_bytes:7883
// 语料里**有**中文（vault 的 `> [!i18n]` 双语契约让笔记正文带整段中文面），所以这不是
// 「没有素材」。直接原因在 `corpus_notes.sql.go:1244-1250`：`to_tsvector('english', …)` 写死，
// 而英文分词器按空白切词，中文不写空白 → 整段中文塌成**一个**词元。数据库自己的输出：
//   to_tsvector('english','递归会收敛因为压缩映射') → '递归会收敛因为压缩映射':1
//
// **断言的是"不许沉默"，不是"必须命中"。** 仓库里第二条检索路（`corpus_grep`，字面/正则、
// never-miss）开头就写着它覆盖「跨过分词边界的中文双字」—— 能力早就在。而同一文件第 12 行写着
// 设计意图：两条路要**保持不同**，靠拢了 agent 就只能瞎选。所以修法不是让 corpus_search 偷做
// grep 的活，而是它在自己的分词器表示不了这个查询时**不许返回裸的 `[]`** —— 要说清「这条路匹配
// 不了你的查询」。选择权仍在 agent，但它第一次拿到了做选择所需的信息。
//
// 为什么这条断言读日志而不读产品的面：访客看到的答案是**对的** —— 英文那条查询捞回了内容，
// 答案照常生成，中文那条空手而归不留任何痕迹。这个缺陷在界面上结构性不可见。
//
// ┌─────────────────────────────────────────────────────────────────────────────────────────┐
// │ ⚠️ 这条用例**今天保护不了那个缺陷**，先别把它的绿当数。                                   │
// │                                                                                          │
// │ 它第一次跑就绿了 —— 而它本该红。原因不是缺陷不存在，是**它跑在另一条检索路上**：          │
// │ `docker-compose.dev.yml:56-57` 给 dev 栈挂了 `MEILI_URL`，**prod 里一个 meilisearch      │
// │ 都没有**（prod compose 里搜不到这个词）。Meili 会切 CJK，所以 e2e 里中文查得到；prod 走   │
// │ PG 的 `to_tsvector('english', …)`，中文整段塌成一个词元，查不到。                        │
// │                                                                                          │
// │ 于是这条断言测的是**能工作的那条路**，绿了也说明不了 prod。这正是                        │
// │ [[verifier-can-lie-about-its-own-coverage]]：先看守卫**扫的是什么**，别只看它绿不绿。     │
// │                                                                                          │
// │ 而这件事比 F-S-2 本身更大：corpus-search 那个 item 的 check 4 自己写着「prod 的默认就是   │
// │ 回退路径，要把它当**主路**验，不是当应急」——**所有搜索相关的 e2e 都在测 Meili**。         │
// │ 让这条用例真正成为守卫，前提是先有办法让 e2e 跑在 PG 那条路上（关掉 Meili 或加一个        │
// │ 强制回退的开关）。那个装置不存在，所以这里先把话说明白，而不是留一个会骗人的绿。          │
// └─────────────────────────────────────────────────────────────────────────────────────────┘

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { publishEntry, seedPublicWiki } from '@/fixtures/corpus';
import {
  resetInstance, findSetupToken, backendLogTail, setSearchDegraded,
} from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockParallelToolCalls } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'cjk-search@example.com', password: 'correct-horse-battery-staple',
  handle: 'cjksearch', fullName: 'CJK Search Owner',
};
const CODE = 'CJKQ-01';
// 笔记正文照真 vault 的双语形状：中英同在一条里。查得到英文、查不到中文,差别才只剩查询语言。
const NOTE_BODY = [
  'Recursion compounds value only if it converges — a contracting reassembly bounds the error.',
  '',
  '递归会收敛因为压缩映射把误差一层层压下去，这是安全递归的核心条件。',
].join('\n');

test.describe('F-S-2 · a CJK query must not come back empty-handed and silent', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedOwner(playwright);
    // **跑在降级路径上,这是这条用例成立的前提。** 头上那个方框记的就是它第一次跑绿的原因:
    // dev 挂着 Meili,而 Meili 会切 CJK,于是它测的是能工作的那条路。装置建好之后
    // (`make dev-pgsearch-on`),它才第一次面对真正出缺陷的那条路。
    setSearchDegraded(true);
  });

  test.afterAll(() => { setSearchDegraded(false); });

  test('CJK and English search the same bilingual note; the CJK one must say something',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      // 同一轮并行发两条 —— 这样两次搜索面对的是同一份语料、同一个时刻,唯一的变量是查询语言。
      const tag = await scriptMockParallelToolCalls(request, [
        { name: 'corpus_search', args: { query: 'contracting reassembly converges' } },
        { name: 'corpus_search', args: { query: '压缩映射' } },
      ]);
      await request.dispose();

      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`hello${tag}`);
      await input.press('Enter');
      const progress = page.getByTestId('chat-progress');
      await expect(progress).toBeVisible({ timeout: 15_000 });
      await expect(progress).toBeHidden({ timeout: 30_000 });

      const results = searchResultsByQuery(backendLogTail());
      const english = results.get('contracting reassembly converges');
      const cjk = results.get('压缩映射');

      // 正对照:英文那条**必须**命中。缺了它,下面的断言在"搜索整个坏掉"时也会红得莫名其妙,
      // 而红的原因会被记到 CJK 头上（[[red-in-the-wrong-place]]）。
      expect(english, 'the English query produced a result at all').toBeDefined();
      expect(english ?? 0, 'the English query finds the bilingual note').toBeGreaterThan(2);

      // 中文那条空手时**不再是 2 字节的裸 `[]`**（F-S-2 已修）：回执带上了那句
      // "空不等于没有，这条索引依赖分词，要确定就用 corpus_grep"，所以它比一个空数组大。
      //
      // ⚠️ 上一版这里写着"这条 wire 不改，`tool-endpoint-corpus.spec.ts:146` 钉住了 `[]`"。
      // 去读那条测试：它只断 `status==200 && body.ok==true`，**从没钉过形状** ——
      // 一个被写成"理由"的假阻塞，把这件事冻了一轮（[[blocker-written-as-reason-ossifies]]）。
      //
      // 现在断的是"空手时说了话"这件事本身。字节数只是它的影子，
      // 具体那句话由 corpus-search-says-when-it-cannot-see-the-query.spec.ts 逐字守。
      expect(cjk, 'the CJK query produced a result at all').toBeDefined();
      expect(cjk ?? -1, '空手回执必须带上那句提醒，不能是个裸的空数组')
        .toBeGreaterThan(2);
    });

  // ④ 落在**决策点**,所以守卫也落在决策点。
  //
  // 空数组这条 wire 被钉死,提示挂不上去;而 agent 是**在读工具说明的那一刻**决定用哪条检索路的,
  // 不是在拿到空数组的那一刻。所以 corpus_search 的说明必须自己讲清两件事:这条索引会漏,
  // 以及漏了该去哪儿(corpus_grep,never-miss)。
  test('corpus_search tells the agent an empty result is not proof of absence',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: CODE, visitor_name: 'Desc Reader',
      });
      const specs = await sessionToolSpecs(request, sess.session_token);
      await request.dispose();

      // 正对照:这个会话真的拿到了工具清单。空清单会让下面每一条 not/contains 都"通过"。
      expect(specs.length, 'the session was handed a tool list at all').toBeGreaterThan(0);
      const search = specs.find((t) => t.name === 'corpus_search');
      expect(search, 'corpus_search is among them').toBeDefined();

      const desc = (search?.description ?? '').toLowerCase();
      expect(desc, 'it says an empty result does not mean the corpus lacks the topic')
        .toContain('does not mean the corpus lacks');
      expect(desc, 'and it names the never-miss path to switch to').toContain('corpus_grep');
    });
});

interface ToolSpecRow { name: string; description?: string }

async function sessionToolSpecs(
  request: APIRequestContext, sessionToken: string,
): Promise<ToolSpecRow[]> {
  const res = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': sessionToken },
  });
  expect(res.status(), 'diag/session answered').toBe(200);
  const body = await res.json() as { tool_specs: ToolSpecRow[] };
  return body.tool_specs;
}

// searchResultsByQuery —— 把 start 行的 query 和 done 行的 result_bytes 按 call_id 配对。
//
// **靠 call_id 配对,不靠出现顺序** —— 这两次调用是并行派发的,顺序不作数。这个字段是 F-S-1
// 补上的;在那之前这条用例根本写不出来,因为两条 done 长得一模一样。
function searchResultsByQuery(log: string): Map<string, number> {
  const queryOf = new Map<string, string>();
  const out = new Map<string, number>();
  for (const line of log.split('\n')) {
    const id = /"call_id":"([^"]+)"/.exec(line)?.[1];
    if (id === undefined || !line.includes('"corpus_search"')) continue;
    const q = /\\"query\\": ?\\"([^\\]*)\\"/.exec(line)?.[1];
    if (q !== undefined) { queryOf.set(id, q); continue; }
    const bytes = /"result_bytes":(\d+)/.exec(line)?.[1];
    const known = queryOf.get(id);
    if (bytes !== undefined && known !== undefined) out.set(known, Number(bytes));
  }
  return out;
}

async function seedOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'cjk-seed');
  const sid = await initMCP(request, token);
  const note = await seedPublicWiki(request, token, sid, {
    body: NOTE_BODY, title: 'recursion-convergence-contraction',
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id: note.wikiID });
  const role = await createRole(request, csrf, {
    name: 'cjk-role', description: 'cjk search spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'cjk', role_id: role.id });
  await request.dispose();
}
