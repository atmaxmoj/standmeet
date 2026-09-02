// corpus-search-owner.spec.ts -- the owner can find one note in their own corpus
// (F-L-39 / F-L-41).
//
// The owner side used to have only two read endpoints: `corpus.list` (the newest page,
// capped at 200, **no offset**) and `corpus.get` (you must already know the id);
// `/admin/wiki` had only tag chips + a two-column grid, **no search box**. So "open my
// good-regulator-theorem note" was impossible on either surface -- while the visitor
// side has always had search, and the backend's `repo.*.Search` full-text search has
// always been there. All that was missing was wiring on this side.
//
// Two assertions pin down two surfaces: the owner's AI client (MCP) and their own
// admin panel (GUI). **Both are required**: pinning only one leaves the other free to
// stay empty indefinitely without anyone noticing ([[test-covers-capability-not-face]]).

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

// NEEDLE -- a word that appears only in that one note. Searching up something else
// means this assertion isn't testing search at all.
const NEEDLE = 'thermosiphon';
const TARGET = 'Thermosiphon Note';

// CALLOUT_* -- **the shape of a real vault**: almost every note this owner writes
// opens with a `> [!i18n]` language-switch callout, with the body coming after it. When
// the preview takes "the first 200 bytes of the body", this block swallows the whole
// thing, and after cleanup not one character is left (F-L-45). The fixture's body used
// to be plain text starting right with the content, so this guard could never see the
// empty preview a real environment produces ([[which-path-is-the-green-on]]).
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
  // A second language pane -- the contract allows N of them. The `[!lang] zh` line is
  // **scaffolding**, and it used to get indexed right along with the switcher: searching
  // `zh` would hit every note that has a Chinese pane, even if that word never appears
  // in its body.
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

    // Create the target note first, then pile on a batch of **newer** notes on top of
    // it -- the list is newest-first, so the target isn't on the first screen. Search
    // has to see past this pile and find it by content, not recency.
    await seedWiki(request, mcpToken, sid, {
      title: TARGET, body: `A note about the ${NEEDLE} loop and passive circulation.`,
    });
    // The real-vault-shaped note: its first 200 bytes are all i18n callout, and the
    // match term comes after it.
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

      // A search result must **be able to say why it matched**, and must not report a
      // fake timestamp (F-L-45 / F-L-46). Neither held on a real vault: the preview was
      // taken from "the first 200 bytes of the body", and those notes almost always
      // open with the `> [!i18n]` language-switch callout, leaving nothing after
      // cleanup; the `updated_at` column was never even fetched by the query, yet still
      // rendered as `1970-01-01T00:00:00Z`.
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
      // "The first 200 bytes of the body" is all markup on a note like this, and
      // cleanup leaves an empty string -- every note in a real vault looks this way.
      expect(row?.preview ?? '', '开头是 callout 的笔记同样要有摘要').not.toBe('');
      expect(row?.preview ?? '', '摘要要来自命中处，这样它同时回答了「为什么是这条」')
        .toContain(CALLOUT_NEEDLE);
      // **"non-empty and contains the match term" isn't enough**: the first preview
      // version seen on real corpus data was `i18n] EN 中文 The as-,StopSel=MCP
      // facade ...` -- which satisfies both checks above. None of these three are
      // allowed to leak to the owner's eyes: ts_headline's option string, callout
      // wreckage, or bare markup.
      for (const junk of [',StopSel', 'StartSel', '[!', '<label', '<input', 'i18n]']) {
        expect(row?.preview ?? '', `摘要里不该出现 ${junk}`).not.toContain(junk);
      }
      // The switcher's **button labels** don't count as content either (UX-78). Cleanup
      // can't catch it: postgres's `ts_headline` itself strips `<label>`/`<input>`, so
      // by the time it reaches Go, only the two words `EN 中文` remain, structurally
      // indistinguishable from prose. The fixture's body is entirely English, so any
      // Chinese text showing up in the preview can only have come from that switcher line.
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
      // The status message must distinguish "this page" from "the whole corpus" -- if
      // the screen doesn't say, the owner will read "not on this page" as "not in my
      // corpus at all".
      await expect(adminPage.getByTestId('corpus-search-state')).toContainText('whole corpus');
    });
});

// The preview half of this is above; this group asks about **the index**: does the
// contract's scaffolding (the switcher's buttons, the `[!lang]` markers) let a note get
// found by a word it never actually wrote. This group reuses the same fixtures as the
// group above, so it runs right after it.
test.describe('契约里的脚手架不该被搜到', () => {
  // The other half of the same thing: button labels must not **be searchable**.
  // **Don't assert on `label` / `radio`**: those two words appear in the tag names, and
  // postgres's `english` analyzer already discards HTML tags as tag tokens -- an
  // assertion like that would already be green before the fix, proving nothing
  // ([[assertion-that-cannot-fail]]; the first draft was written exactly that way).
  // What actually leaks into the index is the **text between the tags**: `EN` and
  // `中文`. Every multilingual note in a real vault carries both of these words, so
  // searching `中文` would surface every single one of them.
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

  // The block's own markers are the same story. The `zh` in `> > [!lang] zh` is
  // contract scaffolding -- a preview seen on real corpus data once opened with a lone
  // `en` (ts_headline's window cut the marker right in the middle, and whoever cleans
  // up the fragment afterward **can't see enough context** to recognize it). So the
  // marker needs to be gone before postgres ever reads it.
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
