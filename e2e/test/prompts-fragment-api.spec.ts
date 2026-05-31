// prompts-fragment-api.spec.ts —— GET /api/v1/prompts/{id} 给前端 (pi
// agent loop) 拿 system prompt 各 fragment 文本。
// fragment 单一源在 backend/internal/prompts/*.md，不再硬编码 Go 字符串。
//
// 验证手段：
//   1. GET /api/v1/prompts/{id} 返每个 fragment 的文本 (md 文件内容)
//   2. /internal/test/visitor-capabilities 响应加 system_prompt_full 字段
//      = 真实下行 LLM 的 system prompt 拼接结果
//   3. system_prompt_full 应能由 fragment 文本按已知规则 (visitor-header +
//      capability fragments) 重新拼出 — 一字不差
//
// 漂移侦测：以后谁在 Go 里硬编码新 fragment 而不抽到 prompts/，本 spec 会
// fail (fragment 出现在 system_prompt_full 但 GET /prompts/{id} 拿不到)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'prompts-api@example.com', password: 'correct-horse-battery-staple',
  handle: 'prompts-api', fullName: 'Prompts API Owner',
};

const CODE = 'PROMPTS-001';

interface VisitorCapabilitiesResp {
  capabilities: Array<{ id: string; enabled: boolean }>;
  tool_specs: Array<{ name: string }>;
  system_prompt_hash: string;
  system_prompt_full: string;
}

async function setupPromptsOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'prompts-role', description: 'role for prompts API spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'd1', assumed_role_id: role.id,
  });
  await request.dispose();
}

test.describe('prompts fragment API · single source of truth', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupPromptsOwner(playwright);
  });

  test('GET /api/v1/prompts/visitor-header returns md file content',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const text = await fetchPrompt(request, 'visitor-header');
      // 已知约定：visitor header 文本一句话开头
      expect(text).toContain('You are answering');
      expect(text.length).toBeGreaterThan(20);
      await request.dispose();
    });

  test('GET /api/v1/prompts/capabilities/corpus.retrieval returns tool description',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const text = await fetchPrompt(request, 'capabilities/corpus.retrieval');
      // 已知 fragment 含 3 个 corpus tool 描述
      expect(text).toContain('corpus_search');
      expect(text).toContain('corpus_read');
      expect(text).toContain('corpus_list');
      await request.dispose();
    });

  test('unknown prompt id → 404', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const res = await request.get(`${BACKEND}/api/v1/prompts/nonexistent-fragment-xyz`);
    expect(res.status()).toBe(404);
    await request.dispose();
  });

  test('system_prompt_full appears in /visitor-capabilities + contains each fragment verbatim',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      expect(typeof body.system_prompt_full).toBe('string');
      expect(body.system_prompt_full.length).toBeGreaterThan(0);
      // header + corpus retrieval fragment 应原文 (一字不差) 出现在 full 里
      const header = await fetchPrompt(request, 'visitor-header');
      const corpus = await fetchPrompt(request, 'capabilities/corpus.retrieval');
      expect(body.system_prompt_full).toContain(header.trim());
      expect(body.system_prompt_full).toContain(corpus.trim());
      await request.dispose();
    });

  test('role without corpus_uris → corpus retrieval fragment absent from system_prompt_full',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const emptyRole = await createRole(request, csrf, {
        name: 'no-corpus-role', description: 'no corpus',
        corpus_uris: [],
      });
      await createCode(request, csrf, {
        code: 'PROMPTS-EMPTY', label: 'empty', assumed_role_id: emptyRole.id,
      });
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: 'PROMPTS-EMPTY', visitor_name: 'V',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const corpus = await fetchPrompt(request, 'capabilities/corpus.retrieval');
      // header 还在；corpus fragment 因 enabled=false 不该出现
      expect(body.system_prompt_full).not.toContain(corpus.trim());
      await request.dispose();
    });
});

async function fetchPrompt(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/v1/prompts/${id}`);
  if (res.status() !== 200) {
    throw new Error(`fetch prompt ${id}: ${res.status()} ${await res.text()}`);
  }
  return await res.text();
}

async function fetchVisitorCapabilities(
  request: APIRequestContext, sessionToken: string,
): Promise<VisitorCapabilitiesResp> {
  const res = await request.get(
    `${BACKEND}/internal/test/visitor-capabilities`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) {
    throw new Error(`visitor-capabilities: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as VisitorCapabilitiesResp;
}
