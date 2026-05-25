// obsidian.ts —— vault import/export 共用 helpers。

import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';

// PNG_1X1 —— 1x1 透明 PNG，最小合法字节流，跟 blog-assets.ts 同形。
export const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export interface VaultFile {
  rel: string;
  body: Uint8Array | string;
}

// uploadVault —— 让 browser context 模拟 `<input webkitdirectory>` 选了
// 一组 file → 触发 import endpoint。直接走 multipart 上传到 server，绕过
// browser file picker（playwright 不易触发 native picker）。
export async function uploadVault(
  request: APIRequestContext, owner: { email: string; password: string },
  files: VaultFile[],
): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const multipart: Record<string, { name: string; mimeType: string; buffer: Buffer }> = {};
  files.forEach((f, i) => {
    multipart['file:' + String(i)] = {
      name: f.rel,
      mimeType: f.rel.endsWith('.md') ? 'text/markdown' : 'application/octet-stream',
      buffer: Buffer.from(f.body),
    };
  });
  const res = await request.post('/api/admin/obsidian/import', {
    headers: { 'X-Csrftoken': csrf },
    multipart,
  });
  expect(res.status()).toBe(200);
  return await res.json() as { created: number; updated: number; skipped: number; errors: string[] };
}

// downloadExport —— 拉 export zip，返 ArrayBuffer。caller 自己用 zip lib 解
// （我们用 fflate / unzipit / native ZipReader 都行；这里返 raw bytes，让
// spec 自己决定如何 inspect）。
export async function downloadExport(
  request: APIRequestContext, owner: { email: string; password: string },
): Promise<Buffer> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get('/api/admin/obsidian/export', {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/zip');
  return Buffer.from(await res.body());
}

// listAdminPosts —— 单条简单 helper。
export async function listAdminPosts(
  request: APIRequestContext, owner: { email: string; password: string },
): Promise<Array<{
  id: string; slug: string; title: string; tags: string[];
  body_md: string; published: boolean; cover_hue: string;
  cover_headline: string; cover_image_asset_id: string;
  asset_urls: Record<string, string>;
}>> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get('/api/admin/posts/', { headers: { 'X-Csrftoken': csrf } });
  return await res.json() as Array<{
    id: string; slug: string; title: string; tags: string[];
    body_md: string; published: boolean; cover_hue: string;
    cover_headline: string; cover_image_asset_id: string;
    asset_urls: Record<string, string>;
  }>;
}

// clickExport —— admin UI export button 触发；等下载完成。
export async function clickExport(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /export to obsidian/i }).click();
  const dl = await downloadPromise;
  const path = await dl.path();
  if (!path) throw new Error('download path missing');
  const fs = await import('node:fs/promises');
  return fs.readFile(path);
}

// makeVaultMD —— 生成一个 frontmatter + body 的 .md 文件 string。
export function makeVaultMD(
  fm: Record<string, unknown>, body: string,
): string {
  const head = renderYAMLBlock(fm);
  return `---\n${head}---\n\n${body}\n`;
}

function renderYAMLBlock(fm: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(fm)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      v.forEach((it) => lines.push(`  - ${String(it)}`));
    } else if (typeof v === 'boolean') {
      lines.push(`${k}: ${v ? 'true' : 'false'}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  return lines.join('\n') + '\n';
}
