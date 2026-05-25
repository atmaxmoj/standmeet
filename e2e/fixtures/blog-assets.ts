// blog-assets.ts —— blog-posts spec 共用的 image / orphan / asset 辅助。
//
// 拆出来守 spec 文件 350-line cap，同时把"1x1 PNG 字节"这种重复 fixture
// 数据集中。
//
// 用法都是 spec 路径内部细节，不暴露给其他 spec。

import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';

// PNG_1X1 —— 1x1 透明 PNG，最小合法 PNG 字节流。所有 image 上传测试共用。
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

interface OwnerCreds { email: string; password: string }

export async function uploadCoverImage(page: Page): Promise<void> {
  await page.getByTestId('post-field-cover-image').setInputFiles({
    name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1X1),
  });
}

// pasteImage —— 在 contenteditable 上 dispatch ClipboardEvent，files 携带
// 1x1 PNG。Tiptap 的 ImageUpload extension handlePaste 截获 → 上传 →
// 插 img 节点。
export async function pasteImage(page: Page, filename: string): Promise<void> {
  await page.evaluate(({ name, bytes }) => {
    const editor = document.querySelector('[data-testid="post-field-body"]');
    if (!editor) throw new Error('editor not found');
    const file = new File([new Uint8Array(bytes)], name, { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const event = new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    });
    editor.dispatchEvent(event);
  }, { name: filename, bytes: Array.from(PNG_1X1) });
}

export async function directUploadAsset(
  request: APIRequestContext, owner: OwnerCreds,
): Promise<string> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.post('/api/admin/assets/', {
    headers: { 'X-Csrftoken': csrf },
    multipart: {
      file: { name: 'orphan.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1X1) },
    },
  });
  const body = await res.json() as { id: string };
  return body.id;
}

export async function assertOrphans(
  request: APIRequestContext, owner: OwnerCreds, expected: string[],
): Promise<void> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get('/api/admin/assets/orphans', {
    headers: { 'X-Csrftoken': csrf },
  });
  const body = await res.json() as { orphans: string[] };
  expect(body.orphans.sort()).toEqual([...expected].sort());
}

export async function runGC(
  request: APIRequestContext, owner: OwnerCreds, expectedDeleted: string[],
): Promise<void> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.delete('/api/admin/assets/orphans', {
    headers: { 'X-Csrftoken': csrf },
  });
  const body = await res.json() as { deleted: string[]; failed: string[] };
  expect(body.deleted.sort()).toEqual([...expectedDeleted].sort());
  expect(body.failed).toHaveLength(0);
}

export async function assertAdminBodyHasURI(
  request: APIRequestContext, owner: OwnerCreds, slug: string,
): Promise<void> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get('/api/admin/posts/', {
    headers: { 'X-Csrftoken': csrf },
  });
  const posts = await res.json() as Array<{
    slug: string; body_md: string; asset_urls: Record<string, string>;
  }>;
  const post = posts.find((p) => p.slug === slug);
  if (!post) throw new Error(`${slug} not in admin list`);
  expect(post.body_md).toMatch(/standmeet-asset:[0-9a-f-]{36}/);
  expect(Object.keys(post.asset_urls).length).toBeGreaterThan(0);
}
