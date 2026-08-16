// corpus-search-owner.spec.ts —— owner 找得到自己语料里的一条（F-L-39 / F-L-41）。
//
// 之前 owner 这一侧只有两个读口：`corpus.list`（最新的一页，上限 200，**没有 offset**）
// 和 `corpus.get`（得先知道 id）；`/admin/wiki` 上只有标签 chip + 两列网格，**没有搜索框**。
// 于是「打开我那条 good-regulator-theorem」在两个面上都做不到 —— 而访客那一侧一直有搜索，
// 后端 `repo.*.Search` 的全文检索也一直在。缺的只是这一侧的接线。
//
// 两条断言分别钉住两个面：owner 的 AI 客户端（MCP）和他自己的后台（GUI）。
// **两个都要**：只钉一个，另一个可以长期空着而没人发现（[[test-covers-capability-not-face]]）。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'corpussearch@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpussearch', fullName: 'Corpus Search Owner',
};

// NEEDLE —— 只出现在那一条笔记里的词。搜出别的东西 = 这条断言没在测搜索。
const NEEDLE = 'thermosiphon';
const TARGET = 'Thermosiphon Note';

// CALLOUT_* —— **真 vault 的形状**：这个 owner 的笔记几乎都以一个 `> [!i18n]` 语言切换
// callout 开头，正文在它后面。摘要取「正文开头 200 字节」时，这一段把它整块吃掉，
// 清洗之后一个字不剩（F-L-45）。夹具的正文以前是纯文本、第一行就是内容，
// 于是这条守卫在 CI 上永远看不见真环境里的空摘要（[[which-path-is-the-green-on]]）。
const CALLOUT_NEEDLE = 'psychrometric';
const CALLOUT_TARGET = 'Callout-Led Note';
const CALLOUT_HEAD = [
  '> [!i18n]',
  '> <label><input type="radio" name="callout-led-lang" checked>EN</label>'
  + '<label><input type="radio" name="callout-led-lang">中文</label>',
  '>',
  '> > [!lang] en',
  '> > # Callout-Led Note',
  '> >',
  '> > > Parent: [[key-designs]]',
  '>',
  // 第二个语言面 —— 契约允许 N 个。`[!lang] zh` 这一行是**脚手架**，而它以前跟切换器
  // 一样进了索引：搜 `zh` 会命中每一条带中文面的笔记，哪怕正文里没这个词。
  '> > [!lang] zh',
  '> > # 湿度图那一条',
  '',
].join('\n');

let mcpToken = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner 找得到自己语料里的一条', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'corpus-search-seed');
    sid = await initMCP(request, mcpToken);

    // 目标那条先建，再堆一批**更新的**笔记压在它上面 —— 列表是 newest-first，
    // 于是目标不在第一屏。搜索要能跨过这堆，找按内容而不是按新旧。
    await seedWiki(request, mcpToken, sid, {
      title: TARGET, body: `A note about the ${NEEDLE} loop and passive circulation.`,
    });
    // 真 vault 形状的那一条：开头 200 字节全是 i18n callout，命中词在后面。
    await seedWiki(request, mcpToken, sid, {
      title: CALLOUT_TARGET,
      body: `${CALLOUT_HEAD}The ${CALLOUT_NEEDLE} chart is the one I keep coming back to.`,
    });
    for (let i = 0; i < 12; i++) {
      await seedWiki(request, mcpToken, sid, {
        title: `Filler Note ${i}`, body: `Unrelated filler body number ${i}.`,
      });
    }
    await request.dispose();
  });

  test('owner-MCP：corpus.search 按内容找得到它（corpus.list 只给最新的一页）',
    async ({ request }) => {
      const found = await callTool<{ id: string; title: string }[]>(
        request, mcpToken, sid, 'corpus.search', { genre: 'wiki', query: NEEDLE },
      );
      const titles = found.map((r) => r.title);
      expect(titles, `搜 "${NEEDLE}" 该命中那一条`).toContain(TARGET);
      expect(found.length, '只有那一条含这个词').toBe(1);

      // 搜索结果得**说得出它为什么被搜到**，而且不能报一个假时间（F-L-45 / F-L-46）。
      // 真 vault 上这两条都不成立：摘要取的是「正文开头 200 字节」，而那些笔记开头
      // 几乎都是 `> [!i18n]` 那个语言切换 callout，清洗后一个字不剩；`updated_at`
      // 那一列查询根本没取，却照样渲成 `1970-01-01T00:00:00Z`。
      const row = found[0] as unknown as { preview?: string; updated_at?: string };
      expect(row.preview ?? '', '每一行都要有摘要，否则 owner 拿到的只是一串 slug')
        .not.toBe('');
      expect(row.updated_at ?? '', '没取到的时间不许渲成 1970 —— 空着比填个假时间诚实')
        .not.toContain('1970');
    });

  test('owner-MCP：真 vault 形状（i18n callout 开头）的笔记也有摘要，而且摘要来自命中处',
    async ({ request }) => {
      const found = await callTool<{ id: string; title: string }[]>(
        request, mcpToken, sid, 'corpus.search', { genre: 'wiki', query: CALLOUT_NEEDLE },
      );
      expect(found.map((r) => r.title), '先确认搜得到它').toContain(CALLOUT_TARGET);
      const row = found.find((r) => r.title === CALLOUT_TARGET) as unknown as
        { preview?: string };
      // 「正文开头 200 字节」在这种笔记上全是标记，清洗后是空串 —— 真 vault 上每一行都这样。
      expect(row?.preview ?? '', '开头是 callout 的笔记同样要有摘要').not.toBe('');
      expect(row?.preview ?? '', '摘要要来自命中处，这样它同时回答了「为什么是这条」')
        .toContain(CALLOUT_NEEDLE);
      // **「非空且含命中词」还不够**：⑤ 在真语料上看到的第一版摘要是
      // `i18n] EN 中文 The as-,StopSel=MCP facade …` —— 它同时满足上面两条。
      // 三样都不许漏到 owner 眼前：ts_headline 的选项串、callout 的残骸、裸标签。
      for (const junk of [',StopSel', 'StartSel', '[!', '<label', '<input', 'i18n]']) {
        expect(row?.preview ?? '', `摘要里不该出现 ${junk}`).not.toContain(junk);
      }
      // 切换器**按钮上的字**也不算内容（UX-78）。清洗抓不到它:postgres 的 `ts_headline`
      // 自己就把 `<label>`/`<input>` 去掉了,交到 Go 手上时只剩 `EN 中文` 两个词,
      // 结构上跟散文一模一样。夹具的正文全是英文,所以 preview 里但凡出现中文,
      // 来源只可能是那一行切换器。
      expect(row?.preview ?? '', '语言切换按钮上的字不是这条笔记的内容')
        .not.toContain('中文');
    });

  test('后台：搜索框按内容找得到它，并说清这次看的是整个语料',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      const box = adminPage.getByTestId('corpus-search-input');
      await expect(box, '后台得有一个按内容找的入口').toBeVisible({ timeout: 8_000 });

      await box.fill(NEEDLE);
      await expect(adminPage.getByTestId('wiki-list')).toContainText(TARGET, { timeout: 8_000 });
      // 状态那句话要区分「这一页」和「整个语料」—— 屏幕不说，owner 会把
      // 「这一页里没有」读成「我的语料里没有」。
      await expect(adminPage.getByTestId('corpus-search-state')).toContainText('whole corpus');
    });
});

// 摘要那一半在上面；这一组问的是**索引**：契约里的脚手架（切换器的按钮、`[!lang]` 标记）
// 会不会让一条笔记因为它自己没写过的词被搜出来。上面那组用同一批夹具，所以这组接着跑。
test.describe('契约里的脚手架不该被搜到', () => {
  // 同一件事的另一半:按钮上的字不该**被搜到**。
  // **不要按 `label` / `radio` 判**:那两个词在标签名里,而 postgres 的 `english` 分析器
  // 本来就把 HTML 标签当 tag token 扔掉 —— 那样的断言在修之前就是绿的,什么也不证明
  // （[[assertion-that-cannot-fail]]，第一版就是这么写的）。漏进索引的恰恰是标签之间的
  // **文字**:`EN` 和 `中文`。真 vault 里每条多语笔记都带这两个词,于是搜「中文」会
  // 把它们全部搜出来。
  test('owner-MCP：切换器上的字不进索引 —— 搜「中文」搜不出这条英文笔记',
    async ({ request }) => {
      const found = await callTool<{ id: string; title: string }[]>(
        request, mcpToken, sid, 'corpus.search', { genre: 'wiki', query: '中文' },
      );
      expect(
        found.map((r) => r.title),
        '「中文」是切换器按钮上的字,这条笔记的正文一个中文字都没有',
      ).not.toContain(CALLOUT_TARGET);
    });

  // 区块自己的标记也一样。`> > [!lang] zh` 里的 `zh` 是契约的脚手架 ——
  // ⑤ 在真语料上看到过一条摘要以孤零零一个 `en` 开头（`ts_headline` 的窗口从标记中间切开，
  // 事后再清片段的人**看不到足够的上下文**认出它）。所以标记要在 postgres 读之前就没了。
  test('owner-MCP：语言标记不进索引 —— 搜 "zh" 搜不出这条笔记',
    async ({ request }) => {
      const found = await callTool<{ id: string; title: string }[]>(
        request, mcpToken, sid, 'corpus.search', { genre: 'wiki', query: 'zh' },
      );
      expect(
        found.map((r) => r.title),
        '`zh` 是 `[!lang]` 标记里的语言码,不是笔记写下的词',
      ).not.toContain(CALLOUT_TARGET);
    });
});
