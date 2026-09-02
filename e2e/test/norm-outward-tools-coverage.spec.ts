// norm-outward-tools-coverage.spec.ts —— [outward] guard tests for the 7 tools in
// the self-managed MCP handles that **previously had zero coverage**.
//
// A coverage audit found these 7 owner-MCP tools had no e2e behavior test at
// all — when the outward handles get moved into routes/mcphandle/ as
// controllers, a break there would go uncaught. This case fills them in (green
// now, and stays green once the move happens):
//   skills        → skill_list · skill_delete
//   mcp_servers   → mcp_server_list · mcp_server_delete
//   writings      → writings.publish
//   custom_page   → custom_page.build
//   seo           → seo.update_settings
//
// The setup (create, etc.) uses already-tested tools, purely to exercise the "dark" tools and verify their behavior.

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

// setupOwnerMCP —— claim + login + API token + MCP init, returns token/sid
// (pulled out of the describe block to respect max-lines-per-function).
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
      const made = await callTool<{ id: string }>(
        request, token, sid, 'mcp_server_create',
        { name: 'cov-srv', url: 'http://mcp-server-mock:9000/mcp' });
      const list = await callTool<Array<{ id: string }>>(
        request, token, sid, 'mcp_server_list', {});
      expect(list.some((s) => s.id === made.id), 'list shows created server')
        .toBe(true);
      const del = await callTool<{ server_id: string }>(
        request, token, sid, 'mcp_server_delete', { server_id: made.id });
      expect(del.server_id).toBe(made.id);
      await request.dispose();
    });

  test('writings: writings.publish 发布草稿', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const w = await callTool<{ writing_id: string }>(
      request, token, sid, 'writing_create',
      { slug: 'cov-writing', title: 'Cov', body_md: '# body' });
    const pub = await callTool<{ published: boolean }>(
      request, token, sid, 'writings.publish', { writing_id: w.writing_id });
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
