// visitor-stream-no-raw-corpus.spec.ts —— the live stream carries no raw retrieval result.
//
// F-A-28 (entity/toolcalls_visitor.go): the visitor side never needs a corpus tool's raw result —
// the UI only counts those calls — and the persisted transcript already drops it. The live SSE
// stream did not: shownResult sent `tool_completed` unchanged, so a corpus_read of a note the AI
// may read but must never cite (show_as_source=false, the meta / persona kind) arrived in the
// browser whole, and the "not a source" rule was enforced only by the browser choosing not to
// show it. Same for corpus_search snippets.
//
// Contract: no corpus_* result text in the stream; a citable read still produces its citation
// (title, path, body for the expand-on-click) — through its own frame, not the raw result.
// Positive control: the citable note's citation is in the stream, so a green cannot come from
// the stream being emptied of everything.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'stream-raw@example.com', password: 'correct-horse-battery-staple',
  handle: 'streamraw', fullName: 'Stream Raw Owner',
};
const HIDDEN = 'HIDDEN-META-MARKER-5c2e persona instructions';
const OPEN = 'OPEN-FACT-MARKER-8d41 shipped in March';

async function streamOf(
  request: APIRequestContext, sess: VisitorSession, tool: { name: string; args: Record<string, unknown> },
): Promise<string> {
  const toolTag = await scriptMockToolCall(request, tool);
  const replyTag = await scriptMockReplyText(request, 'Done.');
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { user_message: `tell me${toolTag}${replyTag}`, conversation_id: sess.conversation_id },
  });
  expect(res.status()).toBe(200);
  return res.text();
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.describe('visitor stream · no raw corpus results', () => {
  let request: APIRequestContext;
  let sess: VisitorSession;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'stream-raw');
    const sid = await initMCP(request, token);
    const hidden = await callTool<{ id: string }>(request, token, sid, 'corpus.create',
      { genre: 'wiki', title: 'Hidden Meta', body: HIDDEN });
    await callTool(request, token, sid, 'corpus.update',
      { genre: 'wiki', id: hidden.id, title: 'Hidden Meta', body: HIDDEN, show_as_source: false });
    await callTool(request, token, sid, 'corpus.create',
      { genre: 'wiki', title: 'Open Fact', body: OPEN });
    const role = await createRole(request, csrf, {
      name: 'stream-raw-role', description: 'reads the whole wiki', corpus_uris: ['wiki://**'],
    });
    const code = await createCode(request, csrf, { code: 'STREAM-RAW1', label: 'streamraw', assumed_role_id: role.id });
    sess = await issueSession(request, { handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V' });
  });
  test.afterAll(async () => { await request.dispose(); });

  test('corpus_read of a non-citable note: its body never reaches the browser', async () => {
    const sse = await streamOf(request, sess, { name: 'corpus_read', args: { path: 'hidden-meta' } });
    expect(sse, 'the tool ran (the stream reports it)').toContain('corpus_read');
    expect(sse, 'the non-citable body is not in the stream').not.toContain('HIDDEN-META-MARKER');
  });

  test('corpus_search snippets never reach the browser', async () => {
    const sse = await streamOf(request, sess, { name: 'corpus_search', args: { query: 'persona instructions' } });
    expect(sse).toContain('corpus_search');
    expect(sse, 'no search snippet in the stream').not.toContain('HIDDEN-META-MARKER');
  });

  test('positive control: a citable read still yields its citation in the stream', async () => {
    const sse = await streamOf(request, sess, { name: 'corpus_read', args: { path: 'open-fact' } });
    expect(sse, 'the citation names the note').toContain('open-fact');
    expect(sse, 'the citation carries the body for expand-on-click').toContain('OPEN-FACT-MARKER');
  });
});
