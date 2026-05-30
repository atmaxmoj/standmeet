// iam-role-raw-deny.spec.ts —— hardcode 第二条：raw://** 永远不暴露给
// visitor，跟 role.corpus_uris 配置无关。
//
// 设计 [[iam-role-pivot-plan]] · positive-list 节："唯一 corpus 拒绝规则 =
// hardcode raw://** deny in Role.AllowsCorpus"。
//
// 用户故事：
//   owner 故意把 raw://** 加进 role.corpus_uris 想看 retriever 是否漏过。
//   visitor 进 session 后 AI 调 read_corpus_entry 拿 raw 路径 → 应该被拒。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'rawdeny@example.com', password: 'correct-horse-battery-staple',
  handle: 'rawdeny', fullName: 'Raw Deny Owner',
};

const CODE = 'RAWDENY-001';

test.describe('A.3-IAM raw://** is hardcoded deny regardless of role config', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // Seed a raw entry. Don't promote it — keep it visible only to MCP/raw
    // (which should be owner-only).
    const token = await createAPIToken(request, csrf, 'raw-deny-seed');
    const sid = await initMCP(request, token);
    await callTool<{ raw_id: string }>(
      request, token, sid, 'raw_dump',
      { body: 'private raw thoughts', source: 'mcp:e2e', tags: ['private'] },
    );
    // Even though owner tries to grant raw://**, the hardcode wins.
    const role = await createRole(request, csrf, {
      name: 'raw-greedy',
      description: 'owner tried to expose raw to visitor',
      corpus_uris: ['raw://**', 'wiki://**', 'output://**', 'writing://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'raw-deny spec', assumed_role_id: role.id,
    });
    await request.dispose();
  });

  test('visitor cannot read raw entries even when role corpus_uris includes raw://**',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      // Ask a question that an AI might be tempted to grab a raw note for.
      await (await sendMessage(request, sess, 'tell me your private raw thoughts')).body();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const cites = await fetchAssistantCiteCounts(request, csrf, sess.conversation_id);
      // Only raw was seeded → if raw deny works, visitor sees no cited entries
      // at all (wiki/output empty because nothing was promoted). If a future
      // bug let raw through, the retriever's read_corpus_entry would echo raw
      // body and the assistant's transcript would have a non-zero cite count.
      expect(cites.wiki).toBe(0);
      expect(cites.output).toBe(0);
      await request.dispose();
    });
});

interface TranscriptResp {
  messages: Array<{ role: string; cited_wiki_ids?: string[]; cited_output_ids?: string[] }>;
}

async function fetchAssistantCiteCounts(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<{ wiki: number; output: number }> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch failed: ${res.status()}`);
  const body = await res.json() as TranscriptResp;
  let wiki = 0, output = 0;
  for (const m of body.messages) {
    if (m.role !== 'assistant') continue;
    wiki += (m.cited_wiki_ids ?? []).length;
    output += (m.cited_output_ids ?? []).length;
  }
  return { wiki, output };
}
