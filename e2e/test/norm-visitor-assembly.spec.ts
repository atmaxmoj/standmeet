// norm-visitor-assembly.spec.ts —— 能力归一化的访客侧黄金快照。
//
// registry-snapshot 锁"哪些 capability 注册了";这条锁"装配给一个访客 session 的
// 工具集" —— 也就是访客真正看得到的东西。归一化重构(统一 builtin/plugin 注册)
// 后,同一个 role 装出来的 tool_specs 必须一字不变。
//
// 用一个 corpus-only role(不挂 skill / 不连 calendar / 不授 echoer)→ 装配结果
// 确定、不依赖外部连器,适合当稳定 golden。

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'norm-assembly@example.com', password: 'correct-horse-battery-staple',
  handle: 'normassembly', fullName: 'Norm Assembly Owner',
};
const CODE = 'NORM-ASM-1';

// GOLDEN —— corpus-only role 装出来的 visitor tool 名单(排序后比,避免顺序噪声;
// 顺序本身由 registry-snapshot 那条锁)。重构后必须一致。
//   corpus_search/read/list —— corpus.retrieval
//   ask_visitor / summarize_conversation —— 无授权门,所有 mode 暴露的基础能力
const GOLDEN_TOOLS: readonly string[] = [
  'corpus_search', 'corpus_read', 'corpus_list',
  'ask_visitor', 'summarize_conversation',
];

interface DiagSessionResp { tool_specs: Array<{ name: string }> }

test.describe('能力归一化 · 访客装配黄金快照', () => {
  let sessionToken = '';
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'norm-asm-role', description: 'corpus-only',
      corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'norm asm', assumed_role_id: role.id,
    });
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Inspector',
    });
    sessionToken = sess.session_token;
    await request.dispose();
  });

  test('corpus-only role 的 visitor tool_specs 逐字等于 golden',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const res = await request.get(`${BACKEND}/internal/diag/session`, {
        headers: { 'X-Session-Token': sessionToken },
      });
      expect(res.status()).toBe(200);
      const body = await res.json() as DiagSessionResp;
      const names = body.tool_specs.map((t) => t.name).sort();
      expect(names).toEqual([...GOLDEN_TOOLS].sort());
      await request.dispose();
    });
});
