// seo-feeds.spec.ts —— 爬虫读 /robots.txt + /sitemap.xml 拿到 owner page +
// indexed wiki landing。
//
// 用户故事：
//   GoogleBot 访问 site root，先 fetch robots.txt 知道是不是允许爬，再
//   fetch sitemap.xml 拿 URL 列表。我们应当在两个 endpoint 上返合规格式 +
//   含 owner public page + 所有 published=true 的 wiki landing。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const APP_BASE = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const INDEXED_SLUG = 'why-standmeet-exists';

test.describe('crawlers can read robots + sitemap', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedIndexedWiki(request);
    await request.dispose();
  });

  test('GET /robots.txt returns sitemap link and allow', async ({ request }) => {
    const res = await request.get(`${APP_BASE}/robots.txt`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
  });

  test('GET /sitemap.xml lists owner page + indexed wiki landings', async ({ request }) => {
    const res = await request.get(`${APP_BASE}/sitemap.xml`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/xml');
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).toContain(`<`);
    expect(body).toContain(`/wiki/${INDEXED_SLUG}<`);
  });
});

async function seedIndexedWiki(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'seed-token');
  const sid = await initMCP(request, apiToken);
  const { wikiID } = await seedPublicWiki(request, apiToken, sid, {
    body: 'StandMeet replaces a résumé for people who think a lot.',
    title: 'Why StandMeet exists',
    tags: ['intro'],
  });
  await callTool<unknown>(request, apiToken, sid, 'seo.set_wiki_seo', {
    wiki_id: wikiID,
    excerpt: 'The founding observation.',
    published: true,
  });
}
