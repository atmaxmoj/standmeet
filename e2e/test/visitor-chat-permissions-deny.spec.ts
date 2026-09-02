// visitor-chat-permissions-deny.spec.ts — as of A.3-IAM-5, ACL is a positive allowlist
// (a hit in RoleSnapshot.CorpusURIs means allow; not in the list means deny).
//
// User story:
//   The owner sends a recruiter an INTRO code bound to the role "recruiter-only". The
//   role is configured with corpus_uris = ['wiki://projects/**'], which allows
//   projects/lucerna but not personal/family. Once the recruiter is in and asks about
//   family, the AI's corpus_search can't reach personal/family, and corpus_read is also
//   refused. The final citation list never includes personal/family.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'RECRUITER-001';
const ALLOWED = 'projects/lucerna';
const DENIED = 'personal/family';

test.describe('positive-list URI ACL excludes paths not in role.corpus_uris', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const csrf = await seedTwoWikis(request);
    const role = await createRole(request, csrf, {
      name: 'recruiter-only', description: 'projects/** visible only',
      corpus_uris: ['wiki://projects/**', 'output://**', 'writing://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'recruiter', purpose: 'positive-list ACL spec',
      assumed_role_id: role.id,
    });
    await request.dispose();
  });

  test('path outside role.corpus_uris never appears in cited refs', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
    });
    // The AI attempts to read the family note (outside the recruiter role's
    // positive-list) → the ACL gate denies the read → it is never cited.
    const readDenied = await scriptMockToolCall(request, {
      name: 'corpus_read', args: { path: DENIED },
    });
    const stream = await sendMessage(request, sess, `tell me about your family${readDenied}`);
    await stream.body();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const paths = await fetchCitedPaths(request, csrf, sess.conversation_id);
    expect(paths).not.toContain(DENIED);
    await request.dispose();
  });
});

async function seedTwoWikis(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'permissions-deny-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'my mother is from singapore.', title: 'Family', path: DENIED,
  });
  await seedWiki(request, token, sid, {
    body: 'lucerna is the project I am proudest of.',
    title: 'Lucerna', path: ALLOWED,
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
  const all = [...body.wiki_refs, ...body.output_refs];
  return all.filter((r) => ids.has(r.id)).map((r) => r.path);
}
