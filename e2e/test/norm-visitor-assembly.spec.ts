// norm-visitor-assembly.spec.ts —— the visitor-side golden snapshot of capability normalization.
//
// registry-snapshot locks "which capabilities are registered"; this one locks "the tool set
// assembled for a visitor session" — what the visitor actually sees. Normalization externalizes the
// loading mechanism of those 6 inward capabilities into an MCP server (plane (b) of the platform
// architecture), and the assembly result must not be affected — the tool_specs assembled from the
// same role must be word-for-word identical.
//
// Use a corpus-only role (no skill / no calendar / no echoer) → the assembly result is
// deterministic and does not depend on external connectors, which makes it a stable golden.

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

// GOLDEN —— the visitor tool list assembled from a corpus-only role (compared sorted, to avoid
// ordering noise; the order itself is locked by registry-snapshot). Must stay identical after the
// refactor.
//   corpus_search/read/list/links —— corpus.retrieval (corpus_links = 1-hop backlinks, #172)
//   corpus_map/resolve/peek       —— the navigation trio added later on the same corpus.retrieval
//                                    (capreg_retrieval_socket_nav.go: skeleton / name→node / batch
//                                    stub). **They go through the same ACL as the first four**: the
//                                    runner takes `corpusScopeOf(req)`, i.e. the role's grant minus
//                                    this code's revocations. This golden once failed to keep up with
//                                    the three of them — the whole point of a golden is to force this
//                                    update out into the open: **adding a line here = admitting the
//                                    visitor was given one more tool**.
//   ask_visitor / summarize_conversation —— no authorization gate, base capabilities exposed in all modes
const CORPUS_RETRIEVAL_TOOLS: readonly string[] = [
  'corpus_search', 'corpus_read', 'corpus_list', 'corpus_links',
  'corpus_map', 'corpus_resolve', 'corpus_peek', 'corpus_grep',
];
const BASELINE_TOOLS: readonly string[] = ['ask_visitor', 'summarize_conversation'];

const GOLDEN_CORPUS_TOOLS: readonly string[] = [...CORPUS_RETRIEVAL_TOOLS, ...BASELINE_TOOLS];

// skill-granted role (the fixture also carries corpus by default) → locks skill.runner assembly
// (skill_use / skill_run_script appear) + corpus + base capabilities.
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
    // This beforeAll makes 8 API calls (claim / login / create role / create code / issue session ×2
    // / issue API token / issue code with skills), while the default budget is 30 seconds and each
    // call is capped at Playwright's default 10. Issuing a session is the heavy one (it assembles the
    // whole visitor tool surface) — on a busy machine it alone can eat 10 seconds. What is relaxed is
    // the driver's patience; the criterion (tool_specs word-for-word equal to golden) is untouched.
    test.setTimeout(120_000);
    resetInstance();
    const request = await playwright.request.newContext({ timeout: 60_000 });
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
    // 2) skill-granted role (attach a skill → skill.runner is exposed)
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
