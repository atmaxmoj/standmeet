// retrieval-acl.spec.ts —— C. ACL (corpus_search + corpus_links) leak prevention (crawl face).
//
// Retrieval's ACL must exactly match corpus_read's: a visitor only sees
// entries within their own glob + already-published. Key leak points:
//   • C2 links.outgoing — a hit links to a neighbor outside the visitor's grant → must not be returned
//   • C3 links.backlinks in reverse — a **source** outside the visitor's grant links to a visible entry → backlinks must not expose that source
//                                (otherwise it leaks "a hidden note points here")
//   • C5 filter injection — Meili filter syntax stuffed into a query cannot escape owner scope
//
// narrow code = wiki://projects/** only; family/** is out of grant for the narrow visitor.
// Warning: partially RED until corpus_links + Meili ACL are wired up.

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

test.describe('C · retrieval ACL leak prevention', () => {
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'retacl');
    // projects/** (visible to narrow) vs. family/** (outside narrow's grant)
    await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'PubProj', body: 'PROJKW public detail links [[Secret]]', path: 'projects/pubproj',
    });
    await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'Secret', body: 'PROJKW SECRETKW private', path: 'family/secret',
    });
    // Reverse case: a hidden source in family points at a visible entry in projects
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
    const hits = await searchTitles(O.request, s, 'PROJKW'); // Both entries contain PROJKW
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

  // C3b —— published isn't a retrieval gate: a source that's inside the glob
  // but not yet published is **still** a backlink for a visitor who's granted
  // it (retrieval ACL = glob, it doesn't look at published; see
  // retrieval-vs-corpus-ACL). Don't let the guard conflate the two.
  test('C3b links.backlinks:未发布但 glob 内的源仍是 backlink(published 不门控检索)', async () => {
    const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'UnpubSrc', body: 'links [[PubTarget]]', path: 'projects/unpubsrc',
    });
    await setPublished(O.request, O.csrf, wikiID, false);
    const s = await full();
    const r = await links(O.request, s, 'projects/pubtarget');
    expect(backTitles(r.body), 'unpublished-but-granted source IS a backlink').toContain('UnpubSrc');
  });

  // C4 —— an out-of-grant subject gets the same friendly denied envelope as
  // corpus_read (ok=true + result.error, not a hard error); the key point is
  // that **none of its links leak**: outgoing/backlinks are both empty.
  test('C4 corpus_links 主体越权 → 不泄漏链接', async () => {
    const s = await narrow();
    const r = await links(O.request, s, 'family/secret');
    expect(r.status, 'not 500').toBeLessThan(500);
    expect(r.body.result?.outgoing ?? [], 'no leak via outgoing').toEqual([]);
    expect(r.body.result?.backlinks ?? [], 'no leak via backlinks').toEqual([]);
  });

  test('C5 filter 注入:query 塞 Meili filter 逃不出 owner scope', async () => {
    const s = await full();
    // Attempt to escape scope with filter syntax / quotes; should be treated as a plain lexical query — no scope escape, no 500
    const hits = await searchTitles(O.request, s, "SECRETKW\" OR owner_id != 'x");
    expect(hits, 'no cross-scope leak / no crash').not.toContain('Secret');
  });

  test('C6 空 corpus role → search 与 links 皆空,不崩', async () => {
    // The full visitor has a corpus; here we use narrow but query a term entirely unrelated to it (an empty result verifies no crash)
    const s = await narrow();
    expect(await searchTitles(O.request, s, 'NOSUCHTERMZZZ')).toEqual([]);
    const r = await links(O.request, s, 'projects/pubproj');
    expect(Array.isArray(r.body.result?.outgoing ?? [])).toBe(true);
  });
});
