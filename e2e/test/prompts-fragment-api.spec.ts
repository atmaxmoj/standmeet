// prompts-fragment-api.spec.ts —— GET /api/v1/prompts/{id} 给前端 (pi
// agent loop) 拿 NON-capability system prompt fragment 文本 (visitor-header 等)。
//
// 归一(#144)后：四个 leaf 能力的 prompt fragment 随能力外置进了各自插件的 MCP
// `instructions`，**不再**由 /api/v1/prompts/{id} 端点提供 (capabilities/* 全 404)。
// 它们仍经 mcp-app 适配器的 SystemPromptFragment 拼进 system_prompt_full —— 所以
// corpus fragment 还在 full 里 (有 corpus scope 时)，只是来源从 prompts/*.md 换成了
// 插件 instructions。本 spec 用 full 里的 verbatim 文案核对，不再从端点取期望值。
//
// 验证手段：
//   1. GET /api/v1/prompts/visitor-header 返 md 文本 (非能力 fragment 仍在端点)
//   2. capabilities/* 已外置 → 端点 404
//   3. system_prompt_full = 真实下行 LLM 的拼接结果，含 corpus fragment verbatim
//      (有 corpus scope 时)，无 scope 时不含。

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

// CORPUS_FRAGMENT_MARK —— corpus.retrieval fragment 的 verbatim 开头 (插件
// instructions = 旧 corpus.retrieval.md 一字不差)。端点不再提供该 fragment，
// 故用这个 marker 在 system_prompt_full 里核对它在/不在。
const CORPUS_FRAGMENT_MARK =
  "You have three tools for accessing the owner's curated corpus:";

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

  test('capability fragments are externalized → not served by the prompts endpoint (404)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // 四个 leaf 能力 fragment 已搬进各自插件的 MCP instructions；prompts 端点不再有。
      const res = await request.get(
        `${BACKEND}/api/v1/prompts/capabilities/corpus.retrieval`);
      expect(res.status()).toBe(404);
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
      // header (端点 fragment) + corpus retrieval fragment (插件 instructions) 都应
      // 原文出现在 full 里。
      const header = await fetchPrompt(request, 'visitor-header');
      expect(body.system_prompt_full).toContain(header.trim());
      expect(body.system_prompt_full).toContain(CORPUS_FRAGMENT_MARK);
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
      // header 还在；corpus fragment 因无 corpus scope (enabled=false) 不该出现
      expect(body.system_prompt_full).not.toContain(CORPUS_FRAGMENT_MARK);
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
    `${BACKEND}/internal/diag/session`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) {
    throw new Error(`visitor-capabilities: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as VisitorCapabilitiesResp;
}
