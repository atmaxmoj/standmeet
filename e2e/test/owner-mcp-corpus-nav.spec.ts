// owner-mcp-corpus-nav.spec.ts —— the owner's AI client gets a map of the corpus.
//
// MCP navigation spec (2026-10-06): the owner face had eight flat corpus tools and no way to see
// the corpus's shape. An external agent landing there filed a methodology note under subjectivity
// while wiki already held a `testing-software-3-0` tree for it, and could not find the canonical
// entry when search came back with no path. The visitor tools have had map / resolve / peek / grep /
// links all along; this puts the same five on the owner MCP.
//
// Asserted through the owner MCP face: the five tools are listed; corpus.map shows the tree;
// corpus.resolve turns a title into its path; corpus.grep finds a CJK phrase the lexical search
// cannot tokenize; corpus.peek and corpus.links answer for the entry.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP, listTools } from '@/fixtures/mcp';

const OWNER = {
  email: 'owner-nav@example.com', password: 'correct-horse-battery-staple',
  handle: 'ownernav', fullName: 'Owner Nav',
};
const LEAF = 'testing-software-3-0/eval-is-the-type-system';
const TITLE = 'Eval is the type system';
const CJK = '评测就是类型系统';

let token = '';
let sid = '';

test.describe('the owner MCP face can navigate the corpus', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'owner-nav');
    sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      title: 'Eval is the type system', path: LEAF,
      body: `An eval suite plays the role a type checker plays. ${CJK}. See [[testing-software-3-0]].`,
    });
    await request.dispose();
  });

  test('the five navigation tools are listed', async ({ request }) => {
    const names = (await listTools(request, token, sid)).map((t) => t.name);
    for (const n of ['corpus.map', 'corpus.resolve', 'corpus.peek', 'corpus.grep', 'corpus.links']) {
      expect(names, n).toContain(n);
    }
  });

  test('map shows the tree; resolve finds the path; grep finds the CJK phrase', async ({ request }) => {
    const map = JSON.stringify(await callTool(request, token, sid, 'corpus.map', {}));
    expect(map, 'the branch is on the map').toContain('testing-software-3-0');

    // The tree path is title-derived; take it from resolve rather than guessing it.
    const resolved = JSON.stringify(
      await callTool(request, token, sid, 'corpus.resolve', { name: TITLE }));
    const path = /"path":"(testing-software-3-0\/[^"]+)"/.exec(resolved)?.[1] ?? '';
    expect(path, `the title resolves to its path under the branch: ${resolved}`).not.toBe('');

    const grep = JSON.stringify(
      await callTool(request, token, sid, 'corpus.grep', { pattern: CJK, fixed: true }));
    expect(grep, 'grep finds the phrase lexical search cannot tokenize').toContain(path);
    expect(grep).toContain(CJK);

    const peek = JSON.stringify(await callTool(request, token, sid, 'corpus.peek', { paths: [path] }));
    expect(peek, 'peek answers for the entry').toContain(TITLE);

    const links = JSON.stringify(await callTool(request, token, sid, 'corpus.links', { path }));
    expect(links, 'links answers with its outgoing/backlinks').toContain('outgoing');
  });
});
