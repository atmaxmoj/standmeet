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
//   microsite   → microsite.build · microsite.set_seo
//
// The seo slot used to be `seo.update_settings`, the global site-SEO settings tool. That feature
// is gone (7037a434e): SEO follows each microsite now, so the tool the owner's client actually
// calls to set SEO is `microsite.set_seo`. It is uncovered on THIS path for the same reason
// update_settings was — microsite-per-page-seo.spec.ts drives the admin SeoPanel (browser →
// PUT /seo), never the MCP tool — so the slot stays, pointed at the tool that exists.
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

// SEO_PAGE —— the page checkMicrositeSEO authors. Its own slug, not the build test's, so this
// case holds when run alone (-g).
const SEO_PAGE = {
  slug: 'cov-seo', title: 'Cov SEO', seoTitle: 'Cov Title',
  seoDescription: 'Cov description', seoImage: 'https://cdn.example.com/cov.png',
};

// checkMicrositeSEO —— microsite.set_seo sets this page's SEO, and microsite.list proves it
// LANDED. A receipt can echo its own request without storing anything, so the read-back through a
// different tool is the half that carries the information.
async function checkMicrositeSEO(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  await callTool(request, token, sid, 'microsite.create',
    { slug: SEO_PAGE.slug, title: SEO_PAGE.title });
  const saved = await callTool<{
    slug: string; seo_title: string; seo_description: string; seo_image: string;
  }>(request, token, sid, 'microsite.set_seo', {
    slug: SEO_PAGE.slug, seo_title: SEO_PAGE.seoTitle,
    seo_description: SEO_PAGE.seoDescription, seo_image: SEO_PAGE.seoImage,
  });
  expect(saved.slug).toBe(SEO_PAGE.slug);
  expect(saved.seo_title).toBe(SEO_PAGE.seoTitle);
  expect(saved.seo_description).toBe(SEO_PAGE.seoDescription);
  expect(saved.seo_image).toBe(SEO_PAGE.seoImage);

  const pages = await callTool<Array<{ slug: string; seo_title: string }>>(
    request, token, sid, 'microsite.list', {});
  const row = pages.find((p) => p.slug === SEO_PAGE.slug);
  expect(row, 'the page is listed').toBeDefined();
  expect(row!.seo_title, 'the SEO title was stored, not just echoed').toBe(SEO_PAGE.seoTitle);
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

  test('microsite: microsite.build 触发构建', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await callTool(request, token, sid, 'microsite.create',
      { slug: 'cov-page', title: 'Cov' });
    await callTool(request, token, sid, 'microsite.write_file',
      { slug: 'cov-page', path: 'App.tsx', content: 'export default () => null' });
    const build = await callTool<{ status: string }>(
      request, token, sid, 'microsite.build', { slug: 'cov-page' });
    expect(['pending', 'building', 'built']).toContain(build.status);
    await request.dispose();
  });

  test('seo: microsite.set_seo 改这个页面的 SEO(SEO 跟着 microsite 走)',
    ({ playwright }) => checkMicrositeSEO(playwright));
});
