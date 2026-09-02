// visitor-chat-cites-output.spec.ts -- when a visitor asks a question,
// grounding pulls from the output layer.
//
// User story:
//   the owner promotes a piece of thinking into the output layer (a
//   finished piece "quotable in full, verbatim, in conversation").
//   A recruiter enters with a code and asks a question; the assistant's
//   message has a non-empty cited_output_ids -- proving the output entry
//   really entered grounding, not just sitting in a file cabinet.
//
// Verification method: the mock provider doesn't echo the prompt, so this
// goes through the admin conversations transcript endpoint and reads
// assistant message.cited_output_ids directly to check whether it contains
// the output id.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const RAW_BODY = 'local-first software is about owning your data, not offline.';
const WIKI_TITLE = 'Local-first ≠ offline';
const OUTPUT_TITLE = 'Local-first essay (polished)';
const CODE = 'INTRO-001';

test.describe('visitor chat retrieval pulls output entries', () => {
  let outputID: string;
  let outputPath: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const setup = await seedThreeTierCorpus(request);
    outputID = setup.outputID;
    outputPath = setup.outputPath;
    await createCode(request, setup.csrf, {
      code: CODE, label: 'intro', purpose: 'visitor-output spec',
    });
    await request.dispose();
  });

  test('assistant message cites the output entry on a visitor question',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
      });
      // The AI reads the seeded output by its real (promote-returned) path; a
      // corpus_read is what records the citation. Mock is pure registration —
      // the test registers the exact tool call, no auto-search guessing.
      const tag = await scriptMockToolCall(request, {
        name: 'corpus_read', args: { path: outputPath },
      });
      const stream = await sendMessage(request, sess, `tell me about local-first${tag}`);
      await stream.body();
      // A new request context has no session cookie: log in separately to get a csrf.
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const cited = await fetchAssistantCitedOutputs(request, csrf, sess.conversation_id);
      expect(cited).toContain(outputID);
      await request.dispose();
    });
});

async function seedThreeTierCorpus(
  request: APIRequestContext,
): Promise<{ outputID: string; outputPath: string; csrf: string }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'corpus-seeder');
  const sid = await initMCP(request, token);
  const raw = await callTool<{ id: string }>(request, token, sid, 'corpus.create', {
    genre: 'raw', body: RAW_BODY, source: 'mcp:spec', tags: [],
  });
  const wiki = await callTool<{ id: string }>(request, token, sid, 'corpus.promote', {
    genre: 'raw', id: raw.id, title: WIKI_TITLE, tags: [],
  });
  const out = await callTool<{ id: string; path: string }>(
    request, token, sid, 'corpus.promote',
    { genre: 'wiki', id: wiki.id, title: OUTPUT_TITLE, tags: [] },
  );
  return { outputID: out.id, outputPath: out.path, csrf };
}

async function fetchAssistantCitedOutputs(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`get transcript failed: ${res.status()}`);
  const body = await res.json() as {
    messages: { role: string; cited_output_ids: string[] }[];
  };
  const assistant = body.messages.find((m) => m.role === 'assistant');
  return assistant?.cited_output_ids ?? [];
}
