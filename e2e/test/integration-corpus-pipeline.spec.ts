// integration-corpus-pipeline.spec.ts —— corpus pipeline end-to-end:
// raw_dump → raw list → promote to wiki → wiki list → wiki SEO landing →
// promote to output → output list → output SEO landing.
//
// 用户故事：
//   owner 在 AI client 里 raw_dump 一条想法 → admin raw list 出现 →
//   promote to wiki → admin wiki list 出现 → wiki SEO landing 可访问 →
//   promote to output → admin output list 出现 → output SEO landing 可访问

import { execSync } from 'node:child_process';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'pipeline@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'pipeline',
  fullName: 'Pipeline Owner',
};

const DB_CONTAINER = 'standmeet-dev-db-1';
const RAW_BODY = 'Pipeline test: raw insight about distributed systems.';
const WIKI_TITLE = 'Distributed systems insight';
const OUTPUT_TITLE = 'Polished essay on distributed systems';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('corpus pipeline: raw → wiki → output end-to-end', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await buildPipeline(request);
    await request.dispose();
  });

  test('admin raw list shows the dumped entry',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await adminPage.waitForURL('**/admin/raw', { timeout: 5_000 });
      await expect(adminPage.getByText(RAW_BODY, { exact: false }))
        .toBeVisible({ timeout: 5_000 });
    });

  test('admin wiki list shows promoted wiki',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      await adminPage.waitForURL('**/admin/wiki', { timeout: 5_000 });
      await expect(adminPage.getByText(WIKI_TITLE, { exact: false }))
        .toBeVisible({ timeout: 5_000 });
    });

  test('wiki SEO landing accessible',
    async ({ page }) => {
      await goto(page, '/wiki/distributed-systems-insight');
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('heading', { name: WIKI_TITLE })).toBeVisible();
    });

  test('admin output list shows promoted output',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'output');
      await adminPage.waitForURL('**/admin/output', { timeout: 5_000 });
      await expect(adminPage.getByText(OUTPUT_TITLE, { exact: false }))
        .toBeVisible({ timeout: 5_000 });
    });

  test('output SEO landing accessible',
    async ({ page }) => {
      await goto(page, '/output/polished-essay-on-distributed-systems');
      await expect(page.getByTestId('output-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('heading', { name: OUTPUT_TITLE })).toBeVisible();
    });
});

async function buildPipeline(request: APIRequestContext) {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'pipeline-token');
  const sid = await initMCP(request, token);
  const raw = await callTool<{ id: string }>(request, token, sid, 'corpus.create', {
    genre: 'raw', body: RAW_BODY, source: 'mcp:pipeline', tags: [],
  });
  const wiki = await callTool<{ id: string }>(request, token, sid, 'corpus.promote', {
    genre: 'raw', id: raw.id, title: WIKI_TITLE,
  });
  await callTool(request, token, sid, 'seo.set_entry_seo', {
    genre: 'wiki', id: wiki.id, excerpt: 'Pipeline test wiki.', published: true,
  });
  const output = await callTool<{ id: string }>(
    request, token, sid, 'corpus.promote',
    { genre: 'wiki', id: wiki.id, title: OUTPUT_TITLE },
  );
  setOutputSeo(output.id);
  return { wikiID: wiki.id, outputID: output.id };
}

// 地址树派生:不写 path 列,只置 published 让 output 进公开 landing/sitemap。
// 公开 URL = /output/<标题 slug>。
function setOutputSeo(outputID: string): void {
  const sql =
    `UPDATE corpus_notes SET excerpt = 'test',`
    + ` published = true WHERE id = '${outputID}' AND genre = 'output'`;
  execSync(`docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`, {
    stdio: 'pipe',
  });
}
