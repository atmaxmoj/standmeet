// output-landing-scale.spec.ts —— 公开 output landing + sitemap 的 newest-50 cap(wiki
// landing 的孪生)。GetOutputLanding / IndexedOutputLandings 现在还吃 50-cap:
//   - 深链接打开最旧的 indexed output → 404
//   - sitemap.xml 漏掉 newest-50 之外的 indexed output
// needle output 最先种(最旧)+ 52 filler 推出最新 50,再直接打开 + 查 sitemap。
//
// 现在(50-cap):landing 404 + sitemap 缺 → **红**;改 DB 端按 path 解析后:绿。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';
import { publishEntry } from '@/fixtures/corpus';

const OWNER = {
  email: 'outlandscale@example.com', password: 'correct-horse-battery-staple',
  handle: 'outlandscale', fullName: 'Output Landing Scale Owner',
};
const NEEDLE_TITLE = 'Pulsar Output';
const NEEDLE_PATH = 'pulsar-output';
const FILLER_COUNT = 52;

let mcpToken = '';

test.describe('public output landing + sitemap cover the whole corpus, not newest-50', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'outland-seed');
    const sid = await initMCP(request, mcpToken);
    const needleID = await promoteOutput(request, sid, NEEDLE_TITLE,
      `The body of ${NEEDLE_TITLE} entry.`);
    await indexOutput(request, sid, needleID);
    for (let i = 0; i < FILLER_COUNT; i += 1) {
      const id = await promoteOutput(request, sid, `Filler Output ${i}`, `filler ${i}`);
      await indexOutput(request, sid, id);
    }
    await request.dispose();
  });

  test('deep link to an indexed output beyond newest-50 renders (not 404)',
    async ({ page }) => {
      await goto(page, `/output/${NEEDLE_PATH}`);
      await expect(page.getByTestId('output-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole('heading', { name: NEEDLE_TITLE })).toBeVisible();
    });

  test('sitemap.xml lists an indexed output beyond newest-50', async ({ page }) => {
    const resp = await page.request.get('http://localhost:8000/sitemap.xml');
    expect(resp.ok()).toBeTruthy();
    expect(await resp.text()).toContain(`/output/${NEEDLE_PATH}`);
  });
});

async function promoteOutput(
  request: APIRequestContext, sid: string, title: string, body: string,
): Promise<string> {
  const raw = await callTool<{ id: string }>(
    request, mcpToken, sid, 'corpus.create',
    { genre: 'raw', body, source: 'mcp:e2e', tags: [] },
  );
  const wiki = await callTool<{ id: string }>(
    request, mcpToken, sid, 'corpus.promote',
    { genre: 'raw', id: raw.id, title, tags: [] },
  );
  const out = await callTool<{ id: string }>(
    request, mcpToken, sid, 'corpus.promote',
    { genre: 'wiki', id: wiki.id, title, tags: [] },
  );
  return out.id;
}

async function indexOutput(
  request: APIRequestContext, sid: string, outputID: string,
): Promise<void> {
  await publishEntry(request, mcpToken, sid, { genre: 'output', id: outputID });
}
