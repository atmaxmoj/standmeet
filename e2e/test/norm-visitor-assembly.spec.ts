// norm-visitor-assembly.spec.ts —— 能力归一化的访客侧黄金快照。
//
// registry-snapshot 锁"哪些 capability 注册了";这条锁"装配给一个访客 session 的
// 工具集" —— 访客真正看得到的东西。归一化把那 6 个 inward 能力的加载机制外置成
// MCP server(平台架构的 (乙)),装配结果不该受影响 —— 同一个 role 装出来的
// tool_specs 必须一字不变。
//
// 用一个 corpus-only role(不挂 skill / 不连 calendar / 不授 echoer)→ 装配结果
// 确定、不依赖外部连器,适合当稳定 golden。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
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
//   corpus_search/read/list/links —— corpus.retrieval (corpus_links = 1-hop backlinks, #172)
//   corpus_map/resolve/peek       —— 同一个 corpus.retrieval 上后加的导航三件套
//                                    (capreg_retrieval_socket_nav.go：skeleton / name→node / 批量
//                                    stub)。**它们和前四个走同一条 ACL**：runner 拿的是
//                                    `corpusScopeOf(req)`，即 role 的 grant 减去这张码的收回。
//                                    这条 golden 一度没跟上它们仨 —— golden 的意义正是逼这个更新
//                                    发生在明面上：**往这个名单里加一行 = 承认多给了访客一件工具**。
//   ask_visitor / summarize_conversation —— 无授权门,所有 mode 暴露的基础能力
const CORPUS_RETRIEVAL_TOOLS: readonly string[] = [
  'corpus_search', 'corpus_read', 'corpus_list', 'corpus_links',
  'corpus_map', 'corpus_resolve', 'corpus_peek', 'corpus_grep',
];
const BASELINE_TOOLS: readonly string[] = ['ask_visitor', 'summarize_conversation'];

const GOLDEN_CORPUS_TOOLS: readonly string[] = [...CORPUS_RETRIEVAL_TOOLS, ...BASELINE_TOOLS];

// skill-granted role(fixture 默认也带 corpus)→ 锁 skill.runner 装配
// (skill_use / skill_run_script 出现)+ corpus + 基础能力。
const GOLDEN_SKILL_TOOLS: readonly string[] = [
  ...CORPUS_RETRIEVAL_TOOLS,
  'skill_use', 'skill_run_script',
  ...BASELINE_TOOLS,
];

interface DiagSessionResp { tool_specs: Array<{ name: string }> }

let corpusToken = '';
let skillToken = '';

test.describe('能力归一化 · 访客装配黄金快照', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    // 1) corpus-only role
    const role = await createRole(request, csrf, {
      name: 'norm-asm-role', description: 'corpus-only',
      corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'norm asm', assumed_role_id: role.id,
    });
    corpusToken = (await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Inspector',
    })).session_token;
    // 2) skill-granted role(挂一个 skill → skill.runner 暴露)
    await createAPIToken(request, csrf, 'norm-asm-seed');
    const skillCode = await issueCodeWithSkills(request, csrf, {
      label: 'norm skill', granted_skills: ['noop.tool'],
    });
    skillToken = (await issueSession(request, {
      handle: OWNER.handle, code: skillCode.code, visitor_name: 'Inspector2',
    })).session_token;
    await request.dispose();
  });

  test('corpus-only role 的 visitor tool_specs 逐字等于 golden',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const names = await toolNames(request, corpusToken);
      expect(names).toEqual([...GOLDEN_CORPUS_TOOLS].sort());
      await request.dispose();
    });

  test('skill-granted role 的 visitor tool_specs 逐字等于 golden(锁 skill.runner)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const names = await toolNames(request, skillToken);
      expect(names).toEqual([...GOLDEN_SKILL_TOOLS].sort());
      await request.dispose();
    });
});

async function toolNames(request: APIRequestContext, token: string): Promise<string[]> {
  const res = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': token },
  });
  if (res.status() !== 200) throw new Error(`diag/session: ${res.status()}`);
  const body = await res.json() as DiagSessionResp;
  return body.tool_specs.map((t) => t.name).sort();
}
