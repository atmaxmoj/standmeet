// embed-widget-carries-code-capabilities.spec.ts -- a widget session gets **the whole
// code**, not "a stripped-down version of the code".
//
// Background (2026-09-01): an embed exposes a given code as <standmeet-chat code="X"> on
// someone else's site. Session issuance just adds **one more origin gate** ahead of the
// code path (embedOriginDenied); once past that gate it goes through the **same**
// dispatchIssueSession as redeeming a code at /gate -- so the corpus ACL + capabilities
// determined by the code's role should freeze into the widget session unchanged. But
// "should" isn't evidence ([[test-covers-capability-not-face]]: an API-driven e2e can
// pass green even when the capability was never wired up at all). This test proves it.
//
// The criteria come in a pair, positive control first ([[guard-must-fail-on-the-bug]]):
//   . Positive: a widget session created from **an allowed origin** can reach the corpus
//     entry that only this code's role can reach, and its capability list is non-empty --
//     both corpus reach and capabilities followed the code.
//   . Negative: a public anonymous session (without this code) cannot reach that same
//     corpus entry -- proving the positive half above came from **this code**, not from
//     being available to everyone.
//
// Writing only the positive control, this test could still pass green for an unrelated
// reason when the widget session never wired up corpus retrieval at all; writing only the
// negative control, it would pass green today simply because the corpus was never seeded
// in the first place. Both halves are required.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createEntry } from '@/fixtures/genre-assets';
import { getRoleByName } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';
import { searchTitles, grepTitles } from '@/fixtures/retrieval';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'embedcaps@example.com', password: 'correct-horse-battery-staple',
  handle: 'embedcaps', fullName: 'Embed Caps Owner',
};

const ALLOWED = 'https://partner.example';
const WIDGET_CODE = 'EMBED-CAPS';

// The CV is a subjectivity entry: `invited` (the default role for every code the product
// issues) cannot reach it, only the `hiring` role explicitly grants subjectivity://cv.
// Using it as the anchor is what lets "brought by this code" be separated from
// "available to everyone" (same corpus entry, same reasoning as cv-reachable).
const CV_TITLE = 'cv';
const EMPLOYER = 'Northwind Logistics';
const TENURE = '2019-03 → 2022-11';
const CV_BODY = [
  '# Curriculum Vitae',
  '',
  `## ${EMPLOYER} — Senior Backend Engineer`,
  `${TENURE} · Hamilton, ON`,
  '',
  'Owned the dispatch pipeline and its verification harness.',
].join('\n');

// createEmbed -- creates an embed (attached to a given code, pinned to an origin).
async function createEmbed(
  request: APIRequestContext, csrf: string, codeID: string, origins: string[],
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/embeds`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code_id: codeID, label: 'partner-site', allowed_origins: origins },
  });
  return res.status();
}

// issueWidgetSession -- creates a code session from **the host site's origin**, exactly
// the cross-origin POST (carrying an Origin header) that a browser's <standmeet-chat>
// would send. Returns the parsed session so it can feed into searchTitles/grepTitles.
async function issueWidgetSession(
  request: APIRequestContext, code: string, origin: string,
): Promise<VisitorSession> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { mode: 'code', code, visitor_name: 'Widget Wanda' },
  });
  if (res.status() !== 200) throw new Error(`widget session failed: ${res.status()}`);
  return await res.json() as VisitorSession;
}

test.describe('embed · a widget session carries the code\'s corpus reach and capabilities', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'embed-caps-spec');
    const sid = await initMCP(request, token);

    // The CV goes into the corpus (subjectivity write path) -- only the hiring role can
    // reach it.
    await createEntry({ request, token, sid }, 'subjectivity', CV_TITLE, CV_BODY);

    // The code carries hiring (a builtin the product seeds itself, not a glob made up on
    // the spot). The embed is pinned to partner.example.
    const hiring = await getRoleByName(request, 'hiring');
    const code = await createCode(request, csrf, {
      code: WIDGET_CODE, label: 'partner widget', assumed_role_id: hiring.id,
    });
    const embedStatus = await createEmbed(request, csrf, code.id, [ALLOWED]);
    expect(embedStatus, '建 embed 必须成功（201）').toBe(201);
    await request.dispose();
  });

  // -- Positive control: the widget session genuinely reaches the CV, and capabilities
  // followed the code --
  test('a widget session from the allowed origin reaches the code\'s corpus',
    async ({ request }) => {
      const sess = await issueWidgetSession(request, WIDGET_CODE, ALLOWED);

      // Corpus reach: this entry can be found, and the two specific facts inside it can
      // be extracted ("reach" = both retrieval capability + corpus ACL followed the code
      // into this widget session).
      expect(await searchTitles(request, sess, EMPLOYER),
        'widget 会话应能检索到码的 role 够得着的语料').toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE),
        'grep 到具体行 = corpus_grep 能力也随码带上了').toContain(CV_TITLE);
    });

  test('the widget session is handed the code\'s capabilities, not a stripped-down set',
    async ({ request }) => {
      const sess = await issueWidgetSession(request, WIDGET_CODE, ALLOWED);
      // A non-empty capability list = the capability set the code's role grants got
      // frozen into the session. The widget only adds one extra origin gate; it must not
      // strip out the capabilities the code already carries
      // ([[retrieval-vs-corpus-acl]]: corpus.retrieval is a capability).
      expect(sess.capabilities?.length ?? 0,
        'widget 会话的 capability 列表不该是空的 —— 码带什么，widget 就带什么').toBeGreaterThan(0);
    });

  // -- Negative control: the same corpus entry is unreachable from a public anonymous
  // session -- proving the positive half above came from **this code** --
  test('a public anonymous session cannot reach the same corpus',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'public', visitor_name: 'Anonymous Ann',
      });
      expect(await searchTitles(request, sess, EMPLOYER)).not.toContain(CV_TITLE);
      expect(await grepTitles(request, sess, TENURE)).not.toContain(CV_TITLE);
    });
});
