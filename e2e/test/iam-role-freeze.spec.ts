// iam-role-freeze.spec.ts — A.3-IAM's core guarantee: at session issue time a
// RoleSnapshot is frozen, so an owner editing a role does not affect a running
// session; the only remedy is to revoke the code.
//
// User story:
//   owner creates role R1 with corpus_uris=['wiki://thinking/**'], issues code C,
//   a visitor enters session S1 → asking about thinking/A gets an answer, asking
//   about output/B gets none (not in R1).
//   owner PUTs /roles/R1, changing corpus_uris to include output://**.
//   - S1, the same session, asks about output/B again → still gets none (the
//     snapshot is already frozen)
//   - a new session S2 issued for the same code C → asking about output/B gets an
//     answer (the snapshot is fresh after re-freezing)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'freeze@example.com', password: 'correct-horse-battery-staple',
  handle: 'freeze', fullName: 'Freeze Owner',
};

const CODE = 'FREEZE-001';
// Address tree derivation: seedWiki(title 'Thinking A', path 'thinking/A') → parent
// 'thinking' + leaf slug('Thinking A')='thinking-a' → tree path 'thinking/thinking-a'.
// output 'Output B' (root) → 'output-b'. The role globs 'thinking/**' / 'output://**'
// still match either way.
const THINKING_PATH = 'thinking/thinking-a';
const OUTPUT_PATH = 'output-b';

test.describe('A.3-IAM role snapshot is frozen at session issue', () => {
  let roleID: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await seedTwoEntries(request, csrf);
    const role = await createRole(request, csrf, {
      name: 'thinking-only',
      description: 'narrow role',
      corpus_uris: ['wiki://thinking/**'],
    });
    roleID = role.id;
    await createCode(request, csrf, {
      code: CODE, label: 'freeze spec', assumed_role_id: roleID,
    });
    await request.dispose();
  });

  test('in-flight session never sees newly-added paths', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    // Pre-edit: session S1 issued under narrow role.
    const s1 = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'V1',
    });
    // Mock is pure registration: the AI reads the thinking entry (in the narrow
    // role) → corpus_read records the citation.
    const readThink = await scriptMockToolCall(request, {
      name: 'corpus_read', args: { path: THINKING_PATH },
    });
    await (await sendMessage(request, s1, `tell me about thinking${readThink}`)).body();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const beforePaths = await fetchCitedPaths(request, csrf, s1.conversation_id);
    expect(beforePaths).toContain(THINKING_PATH);

    // Owner widens the role to include output://**.
    await widenRole(request, csrf, roleID);

    // Same in-flight session: the AI attempts to read output B, but the frozen
    // snapshot (narrow role) denies it → corpus_read blocked → never cited.
    const readOut = await scriptMockToolCall(request, {
      name: 'corpus_read', args: { path: OUTPUT_PATH },
    });
    await (await sendMessage(request, s1, `tell me about output B${readOut}`)).body();
    const stillPaths = await fetchCitedPaths(request, csrf, s1.conversation_id);
    expect(stillPaths).not.toContain(OUTPUT_PATH);
    await request.dispose();
  });

  test('newly-issued session uses the widened role', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    // S2: new session under the widened role → output should be reachable.
    const s2 = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'V2',
    });
    const readOut = await scriptMockToolCall(request, {
      name: 'corpus_read', args: { path: OUTPUT_PATH },
    });
    await (await sendMessage(request, s2, `tell me about output B${readOut}`)).body();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const paths = await fetchCitedPaths(request, csrf, s2.conversation_id);
    expect(paths).toContain(OUTPUT_PATH);
    await request.dispose();
  });
});

async function seedTwoEntries(request: APIRequestContext, csrf: string): Promise<void> {
  const token = await createAPIToken(request, csrf, 'freeze-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'thinking note about systems design',
    title: 'Thinking A', path: THINKING_PATH,
  });
  // Promote a separate wiki to output so it lives under output:// namespace.
  await seedOutput(request, token, sid);
}

async function seedOutput(
  request: APIRequestContext, apiToken: string, sessionID: string,
): Promise<void> {
  // raw → wiki → output chain; the output tree path = slug('Output B') = 'output-b'.
  const raw = await callTool<{ id: string }>(
    request, apiToken, sessionID, 'corpus.create',
    { genre: 'raw', body: 'output essay about retrieval', source: 'mcp:e2e', tags: [] },
  );
  const wiki = await callTool<{ id: string }>(
    request, apiToken, sessionID, 'corpus.promote',
    { genre: 'raw', id: raw.id, title: 'Wiki B', tags: [] },
  );
  await callTool<{ id: string }>(
    request, apiToken, sessionID, 'corpus.promote',
    { genre: 'wiki', id: wiki.id, title: 'Output B', tags: [] },
  );
}

async function widenRole(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const res = await request.put(`${BACKEND}/api/admin/roles/${id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'thinking-only',
      description: 'widened mid-session',
      prompt_id: null,
      corpus_uris: ['wiki://thinking/**', 'output://**'],
      skill_ids: [],
      mcp_server_ids: [],
    },
  });
  if (res.status() !== 200) {
    throw new Error(`widen role failed: ${res.status()} ${await res.text()}`);
  }
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
  const all = [...body.wiki_refs, ...body.output_refs];
  const cited = new Set<string>();
  for (const m of body.messages) {
    if (m.role !== 'assistant') continue;
    m.cited_wiki_ids.forEach((id) => cited.add(id));
    m.cited_output_ids.forEach((id) => cited.add(id));
  }
  return all.filter((r) => cited.has(r.id)).map((r) => r.path);
}

