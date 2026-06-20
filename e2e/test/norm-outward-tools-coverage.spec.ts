// norm-outward-tools-coverage.spec.ts —— 【对外】自管理 MCP handles 里**之前零覆盖**
// 的 7 个工具的守护测试。
//
// 覆盖审计发现这 7 个 owner-MCP 工具没有任何 e2e 行为测试 —— 把对外 handles 搬进
// routes/mcphandle/ 当 controller 时,它们坏了没测试逮。这条把它们补上(现在就绿,
// 搬完保持绿):
//   skills        → skill_list · skill_delete
//   mcp_servers   → mcp_server_list · mcp_server_delete
//   writings      → writing_publish
//   custom_page   → custom_page.build
//   seo           → seo.update_settings
//
// 前置(create 等)用的是已被测的工具,只为把"黑"工具调起来验行为。

import { test, expect } from '@/fixtures/test';

import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'norm-outward-cov@example.com', password: 'correct-horse-battery-staple',
  handle: 'normoutcov', fullName: 'Norm Outward Cov Owner',
};

let token = '';
let sid = '';

// setupOwnerMCP —— claim + login + API token + MCP init,返 token/sid(从 describe
// 抽出守 max-lines-per-function)。
async function setupOwnerMCP(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'norm-outward-cov');
  sid = await initMCP(request, token);
  await request.dispose();
}

test.describe('能力归一化 · 【对外】零覆盖 MCP 工具守护(搬动前补网)', () => {
  test.beforeAll(async ({ playwright }) => { await setupOwnerMCP(playwright); });

  test('skills: skill_list 列出 + skill_delete 删', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await callTool(request, token, sid, 'skill_create', {
      name: 'cov-skill', description: 'coverage', prompt: 'do the thing',
    });
    const list = await callTool<Array<{ id: string; name: string }>>(
      request, token, sid, 'skill_list', {});
    const created = list.find((s) => s.name === 'cov-skill');
    expect(created, 'skill_list shows the created skill').toBeDefined();
    const del = await callTool<{ skill_id: string }>(
      request, token, sid, 'skill_delete', { skill_id: created!.id });
    expect(del.skill_id).toBe(created!.id);
    await request.dispose();
  });

  test('mcp_servers: mcp_server_list 列出 + mcp_server_delete 删',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const made = await callTool<{ server_id: string }>(
        request, token, sid, 'mcp_server_create',
        { name: 'cov-srv', url: 'http://mcp-server-mock:9000/mcp' });
      const list = await callTool<Array<{ id: string }>>(
        request, token, sid, 'mcp_server_list', {});
      expect(list.some((s) => s.id === made.server_id), 'list shows created server')
        .toBe(true);
      const del = await callTool<{ server_id: string }>(
        request, token, sid, 'mcp_server_delete', { server_id: made.server_id });
      expect(del.server_id).toBe(made.server_id);
      await request.dispose();
    });

  test('writings: writing_publish 发布草稿', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const w = await callTool<{ writing_id: string }>(
      request, token, sid, 'writing_create',
      { slug: 'cov-writing', title: 'Cov', body_md: '# body' });
    const pub = await callTool<{ published: boolean }>(
      request, token, sid, 'writing_publish', { writing_id: w.writing_id });
    expect(pub.published).toBe(true);
    await request.dispose();
  });

  test('custom_page: custom_page.build 触发构建', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await callTool(request, token, sid, 'custom_page.create',
      { slug: 'cov-page', title: 'Cov' });
    await callTool(request, token, sid, 'custom_page.write_file',
      { slug: 'cov-page', path: 'App.tsx', content: 'export default () => null' });
    const build = await callTool<{ status: string }>(
      request, token, sid, 'custom_page.build', { slug: 'cov-page' });
    expect(['pending', 'building', 'built']).toContain(build.status);
    await request.dispose();
  });

  test('seo: seo.update_settings 改全站 SEO 设置', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const saved = await callTool<{ index_robots: boolean; og_template: string }>(
      request, token, sid, 'seo.update_settings',
      { index_robots: false, sitemap_extras: ['/extra'], og_template: 'tpl' });
    expect(saved.index_robots).toBe(false);
    expect(saved.og_template).toBe('tpl');
    await request.dispose();
  });
});
