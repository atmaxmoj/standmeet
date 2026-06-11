// output-landing.spec.ts —— /output/<slug> SEO landing 端到端。
//
// 用户故事：
//   owner 把 wiki 提炼成 output → 给 output 设 seo_slug + seo_indexed → 在
//   admin /admin/output 卡片 "view live ↗" → 访客看到 /output/<slug>
//   完整 markdown body，sitemap.xml 列了这条 URL。
//
// 当前 seo_slug 写入只通过 MCP / DB；admin UI 后面再补 SEO 编辑。这里
// 直接走 SetWikiSEO 同套路：postgres UPDATE 直写 output_entries。

import { execSync } from 'node:child_process';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const OUTPUT_TITLE = 'Local-first essay';
const OUTPUT_BODY = 'POLISHED_OUTPUT_BODY_MARKER';
const SLUG = 'local-first-essay';

const DB_CONTAINER = 'standmeet-dev-db-1';

test.describe('public /output/<slug> SEO landing', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const id = await seedOutputViaMCP(request);
    setOutputSeo(id, 'Polished local-first essay description');
    await request.dispose();
  });

  test('visitor opens /output/<slug> → sees full body + sitemap lists URL',
    async ({ page }) => {
      await goto(page, `/output/${SLUG}`);
      await expect(page.getByTestId('output-landing')).toBeVisible();
      await expectBodyAndTitle(page);
      // #39: document 页返回 writing index,不再「← home」回 /。
      await expect(page.getByRole('link', { name: '← writing' }))
        .toHaveAttribute('href', '/writings');
      const sitemap = await fetchSitemap(page);
      expect(sitemap).toContain(`/output/${SLUG}`);
    });
});

async function seedOutputViaMCP(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'corpus-seeder');
  const sid = await initMCP(request, token);
  const raw = await callTool<{ raw_id: string }>(request, token, sid, 'raw_dump', {
    body: 'rough draft on local-first software', source: 'mcp:spec', tags: [],
  });
  const wiki = await callTool<{ wiki_id: string }>(request, token, sid, 'promote_to_wiki', {
    raw_id: raw.raw_id, title: 'Local-first sketch', tags: [],
  });
  const out = await callTool<{ output_id: string }>(
    request, token, sid, 'promote_wiki_to_output',
    {
      wiki_id: wiki.wiki_id, title: OUTPUT_TITLE, tags: [],
      // body 在 promote 时复用 source wiki body，我们再写 SQL 覆一份 distinct marker。
    },
  );
  // overwrite body via DB to embed the marker string we'll assert in browser.
  setOutputBody(out.output_id, OUTPUT_BODY);
  return out.output_id;
}

function setOutputBody(outputID: string, body: string): void {
  const sql = `UPDATE output_entries SET body = '${body}' WHERE id = '${outputID}'`;
  execSync(`docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`, {
    stdio: 'pipe',
  });
}

// 地址树派生(标题 slug):公开 URL = /output/local-first-essay,不写 path 列,
// 只置 seo_indexed + 描述让它进公开 landing/sitemap。
function setOutputSeo(outputID: string, description: string): void {
  const sql =
    `UPDATE output_entries SET seo_description = '${description}',`
    + ` seo_indexed = true WHERE id = '${outputID}'`;
  execSync(`docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`, {
    stdio: 'pipe',
  });
}

async function expectBodyAndTitle(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: OUTPUT_TITLE })).toBeVisible();
  await expect(page.getByText(OUTPUT_BODY, { exact: false })).toBeVisible();
}

async function fetchSitemap(page: Page): Promise<string> {
  const resp = await page.request.get('http://localhost:8000/sitemap.xml');
  expect(resp.ok()).toBeTruthy();
  return resp.text();
}
