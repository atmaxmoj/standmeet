// iam-role-freeze.spec.ts —— A.3-IAM 核心承诺：session issue 时 freeze 出
// RoleSnapshot，owner 改 role 不影响在跑 session；唯一补救 = revoke code。
//
// 用户故事：
//   owner 建 role R1 corpus_uris=['wiki://thinking/**']，发码 C，
//   visitor 进 session S1 → 问 thinking/A 拿到，问 output/B 拿不到（不在 R1）。
//   owner PUT /roles/R1 把 corpus_uris 改成包含 output://**。
//   - S1 同一 session 再问 output/B → 仍拿不到（snapshot 已冻结）
//   - 新发 session S2 同 C → 问 output/B 拿到（重新 freeze 后 snapshot 新了）

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'freeze@example.com', password: 'correct-horse-battery-staple',
  handle: 'freeze', fullName: 'Freeze Owner',
};

const CODE = 'FREEZE-001';
const THINKING_PATH = 'thinking/A';
const OUTPUT_PATH = 'B';

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
    await (await sendMessage(request, s1, 'tell me about thinking')).body();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const beforePaths = await fetchCitedPaths(request, csrf, s1.conversation_id);
    expect(beforePaths).toContain(THINKING_PATH);

    // Owner widens the role to include output://**.
    await widenRole(request, csrf, roleID);

    // Same in-flight session: ask about output. Snapshot is frozen → still excluded.
    await (await sendMessage(request, s1, 'tell me about output B')).body();
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
    await (await sendMessage(request, s2, 'tell me about output B')).body();
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
  // raw → wiki → output chain, output path = OUTPUT_PATH.
  const raw = await callTool<{ raw_id: string }>(
    request, apiToken, sessionID, 'raw_dump',
    { body: 'output essay about retrieval', source: 'mcp:e2e', tags: [] },
  );
  const wiki = await callTool<{ wiki_id: string }>(
    request, apiToken, sessionID, 'promote_to_wiki',
    { raw_id: raw.raw_id, title: 'Wiki B', tags: [] },
  );
  await callTool<{ output_id: string }>(
    request, apiToken, sessionID, 'promote_wiki_to_output',
    { wiki_id: wiki.wiki_id, title: 'Output B', path: OUTPUT_PATH, tags: [] },
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

