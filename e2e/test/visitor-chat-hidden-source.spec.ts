// visitor-chat-hidden-source.spec.ts —— for a show_as_source=false entry, the AI
// can read and use its content, but readCollector doesn't collect it, and cited never shows that path.
//
// User story:
//   owner puts their "own preferences / persona prompt" into wiki, marked show_as_source=false:
//   the AI can reference it while answering, but the visitor shouldn't see this meta entry in the cited list.
//   The spec seeds one hidden meta + one visible projects/lucerna; when the visitor asks about
//   lucerna the AI will search→ see lucerna→read it; even if the hidden entry is read
//   by the AI, it won't appear in cited. The spec strictly asserts cited doesn't contain the hidden path.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const HIDDEN = 'meta/persona';
const VISIBLE = 'projects/lucerna';

test.describe('show_as_source=false hides entry from cited footer', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const csrf = await seedHiddenAndVisible(request);
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'hidden-source spec',
    });
    await request.dispose();
  });

  test('hidden entry can be read but never surfaces as cited', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
    });
    // Mock is pure registration: register a corpus_read for BOTH the hidden meta
    // entry and the visible one (mirrors "persona and projects"). Reading HIDDEN
    // is the load-bearing bit — if show_as_source suppression regressed, the read
    // would surface it in cited and this test fails.
    const readHidden = await scriptMockToolCall(request, {
      name: 'corpus_read', args: { path: HIDDEN },
    });
    const readVisible = await scriptMockToolCall(request, {
      name: 'corpus_read', args: { path: VISIBLE },
    });
    const stream = await sendMessage(
      request, sess, `tell me about your persona and projects${readHidden}${readVisible}`,
    );
    await stream.body();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const paths = await fetchCitedPaths(request, csrf, sess.conversation_id);
    expect(paths).not.toContain(HIDDEN);
  });
});

async function seedHiddenAndVisible(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'hidden-source-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'answer as alice, warm, direct, slightly terse.',
    title: 'Persona', path: HIDDEN, showAsSource: false,
  });
  await seedWiki(request, token, sid, {
    body: 'lucerna is my local-first persona tool.',
    title: 'Lucerna', path: VISIBLE,
  });
  return csrf;
}

interface CitedRefView { id: string; title: string; path: string }
interface TranscriptResp {
  messages: Array<{ role: string; cited_wiki_ids: string[]; cited_output_ids: string[] }>;
  wiki_refs: CitedRefView[];
  output_refs: CitedRefView[];
}

async function fetchCitedPaths(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch failed: ${res.status()}`);
  const body = await res.json() as TranscriptResp;
  const assistant = body.messages.find((m) => m.role === 'assistant');
  const ids = new Set([
    ...(assistant?.cited_wiki_ids ?? []),
    ...(assistant?.cited_output_ids ?? []),
  ]);
  return [...body.wiki_refs, ...body.output_refs]
    .filter((r) => ids.has(r.id)).map((r) => r.path);
}
