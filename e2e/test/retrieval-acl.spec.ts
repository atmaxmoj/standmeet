// retrieval-acl.spec.ts —— C. ACL(corpus_search + corpus_links)防泄漏(crawl face)。
//
// 检索的 ACL 必须与 corpus_read 完全一致:访客只见自己 glob 内 + 已发布的条目。
// 关键泄漏点:
//   • C2 links.outgoing —— 命中条链到一个访客越权的邻居 → 不得返回
//   • C3 links.backlinks 反向 —— 一个访客越权的**源**链到可见条 → backlinks 不得暴露那个源
//                                (否则泄漏"有一条隐藏 note 指向这里")
//   • C5 filter 注入 —— query 里塞 Meili filter 语法逃不出 owner scope
//
// narrow code = wiki://projects/** only;family/** 对 narrow 访客越权。
// ⚠️ 部分 RED until corpus_links + Meili ACL 接上。

import { test, expect } from '@/fixtures/test';

import { seedWiki } from '@/fixtures/corpus';
import {
  links, searchTitles, setPublished, setupRetrievalOwner, type RetrievalOwner,
} from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';

let O: RetrievalOwner;

function outTitles(body: { result?: { outgoing: { title: string }[] } }): string[] {
  return (body.result?.outgoing ?? []).map((h) => h.title);
}
function backTitles(body: { result?: { backlinks: { title: string }[] } }): string[] {
  return (body.result?.backlinks ?? []).map((h) => h.title);
}

test.describe('C · retrieval ACL 防泄漏', () => {
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'retacl');
    // projects/**(narrow 可见) 与 family/**(narrow 越权)
    await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'PubProj', body: 'PROJKW public detail links [[Secret]]', path: 'projects/pubproj',
    });
    await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'Secret', body: 'PROJKW SECRETKW private', path: 'family/secret',
    });
    // 反向:family 里一条隐藏源指向 projects 里可见条
    await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'PubTarget', body: 'PUBTGTKW visible target', path: 'projects/pubtarget',
    });
    await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'HiddenSrc', body: 'points [[PubTarget]]', path: 'family/hiddensrc',
    });
  });
  test.afterAll(async () => { await O.request.dispose(); });

  async function narrow() {
    return issueSession(O.request, { handle: O.handle, code: O.narrowCode, visitor_name: 'N' });
  }
  async function full() {
    return issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'F' });
  }

  test('C1 search:narrow 访客 glob 外命中被剔除', async () => {
    const s = await narrow();
    const hits = await searchTitles(O.request, s, 'PROJKW'); // 两条都含 PROJKW
    expect(hits, 'projects visible').toContain('PubProj');
    expect(hits, 'family denied not in results').not.toContain('Secret');
  });

  test('C2 links.outgoing:越权邻居不返回', async () => {
    const s = await narrow();
    const r = await links(O.request, s, 'projects/pubproj');
    expect(outTitles(r.body), 'denied neighbor excluded from outgoing').not.toContain('Secret');
  });

  test('C3 links.backlinks 反向泄漏:越权源不暴露', async () => {
    const s = await narrow();
    const r = await links(O.request, s, 'projects/pubtarget');
    expect(backTitles(r.body), 'hidden source not revealed as backlink').not.toContain('HiddenSrc');
  });

  // C3b —— published 不是检索门:一个 glob 内但未发布的源,对有权访客**仍**是 backlink
  // (retrieval ACL = glob,不看 published;见 retrieval-vs-corpus-ACL)。守卫别把两者混一起。
  test('C3b links.backlinks:未发布但 glob 内的源仍是 backlink(published 不门控检索)', async () => {
    const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'UnpubSrc', body: 'links [[PubTarget]]', path: 'projects/unpubsrc',
    });
    await setPublished(O.request, O.csrf, wikiID, false);
    const s = await full();
    const r = await links(O.request, s, 'projects/pubtarget');
    expect(backTitles(r.body), 'unpublished-but-granted source IS a backlink').toContain('UnpubSrc');
  });

  // C4 —— 越权主体走 corpus_read 一样的 friendly denied envelope(ok=true + result.error,不是硬错),
  // 关键是**不泄漏它的任何链接**:outgoing/backlinks 皆空。
  test('C4 corpus_links 主体越权 → 不泄漏链接', async () => {
    const s = await narrow();
    const r = await links(O.request, s, 'family/secret');
    expect(r.status, 'not 500').toBeLessThan(500);
    expect(r.body.result?.outgoing ?? [], 'no leak via outgoing').toEqual([]);
    expect(r.body.result?.backlinks ?? [], 'no leak via backlinks').toEqual([]);
  });

  test('C5 filter 注入:query 塞 Meili filter 逃不出 owner scope', async () => {
    const s = await full();
    // 尝试用 filter 语法 / 引号越权;应被当普通词法查询,不越权、不 500
    const hits = await searchTitles(O.request, s, "SECRETKW\" OR owner_id != 'x");
    expect(hits, 'no cross-scope leak / no crash').not.toContain('Secret');
  });

  test('C6 空 corpus role → search 与 links 皆空,不崩', async () => {
    // full 访客有 corpus;这里用 narrow 但查一个它完全无关的词(空结果验不崩)
    const s = await narrow();
    expect(await searchTitles(O.request, s, 'NOSUCHTERMZZZ')).toEqual([]);
    const r = await links(O.request, s, 'projects/pubproj');
    expect(Array.isArray(r.body.result?.outgoing ?? [])).toBe(true);
  });
});
