// norm-outward-toolset.spec.ts —— 【对外】自管理 MCP handles 的 **tools/list 工具面
// golden**(真实 MCP 客户端发现路径)。
//
// 这条守的是 owner 用真实 MCP 客户端(Claude Desktop / Cursor)连进来时,tools/list
// 实际返回的工具清单。它跟 norm-outward-handles.spec.ts(走 diag/registry 看 capability
// id)是**两条不同的路径**:
//   - registry 那条:能力注册对不对(进程内视角)。
//   - 这条:工具被序列化、经 HTTP 传输、被客户端发现 —— **能不能真用起来**。
//
// 为什么单列:tools/list 会把**全部**工具的 InputSchema 一次性 marshal。任何一个工具
// 的 InputSchema 是坏 JSON,整张表 marshal 失败 → 返空 body → 客户端一个工具都发现不
// 了(owner MCP 整个不可用)。这正是历史上真实发生过的 bug(skill_create 的 schema 在
// backtick 原始串里误用了 Go 字符串拼接 `"+`)。Go 侧有 schema_valid_test 兜底,这条在
// e2e 把"真客户端能发现完整工具面"钉死。
//
// golden = 全部 owner_only 工具(内建 47 + jobs 插件 10 = 57)。加/删 owner 工具时这条
// 会红 —— 那是**有意**的:逼你同步更新工具面预期。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, listTools } from '@/fixtures/mcp';

const OWNER = {
  email: 'norm-toolset@example.com', password: 'correct-horse-battery-staple',
  handle: 'normtoolset', fullName: 'Norm Toolset Owner',
};

// GOLDEN —— tools/list 必须逐字返回这 56 个 owner 工具(排序后比,顺序噪声由 mcp-go
// 注册顺序决定、不在本条职责内)。
const GOLDEN_TOOLSET: readonly string[] = [
  // me / seo / codes
  'me',
  'seo.set_output_seo', 'seo.set_wiki_seo', 'seo.update_settings',
  'codes.create', 'codes.revoke', 'codes.update_quotas',
  // corpus raw / output / wiki
  'raw_dump', 'list_recent_raw',
  'list_recent_output', 'update_output', 'delete_output',
  'promote_to_wiki', 'promote_wiki_to_output',
  'list_recent_wiki', 'update_wiki', 'delete_wiki',
  // chat / prompts / roles
  'chat.show_grounding',
  'prompt_create', 'prompt_list', 'prompt_delete',
  'role_create', 'role_list', 'role_delete', 'roles.set_dock_buttons',
  // mcp servers / skills
  'mcp_server_create', 'mcp_server_list', 'mcp_server_delete',
  'skill_create', 'skill_list', 'skill_delete',
  // writings
  'writing_create', 'writing_list', 'writing_publish', 'writing_delete',
  // custom page
  'custom_page.create', 'custom_page.list', 'custom_page.get_build',
  'custom_page.write_file', 'custom_page.build', 'custom_page.delete',
  'custom_page.promote_to_staging', 'custom_page.promote_to_live',
  'custom_page.rollback',
  // page / calendar
  'page.update_handle',
  'calendar.list_slots', 'calendar.cancel_booking',
  // jobs plugin (jobs / resume / applications)
  'jobs.register_source', 'jobs.list_sources', 'jobs.unregister_source',
  'jobs.fetch_new', 'jobs.show', 'jobs.discard',
  'resume.draft', 'resume.update_draft', 'resume.discard_draft',
  'applications.commit',
];

let token = '';
let sid = '';

test.describe('能力归一化 · 【对外】tools/list 工具面 golden(真实客户端发现路径)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'norm-toolset');
    sid = await initMCP(request, token);
    await request.dispose();
  });

  test('tools/list 返回完整 owner 工具面(逐字等于 golden)', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const names = (await listTools(request, token, sid)).map((t) => t.name).sort();
    expect(names).toEqual([...GOLDEN_TOOLSET].sort());
    await request.dispose();
  });

  test('tools/list body 非空(回归守护:坏 schema 曾让整张表返空)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const tools = await listTools(request, token, sid);
      expect(tools.length).toBeGreaterThan(0);
      // 每个工具都得有 name —— 证明序列化没被某个坏 schema 截断。
      for (const t of tools) expect(t.name).toBeTruthy();
      await request.dispose();
    });
});
