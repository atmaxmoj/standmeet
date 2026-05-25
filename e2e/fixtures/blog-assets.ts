// blog-assets.ts —— blog-posts spec 共用的 image / asset 辅助。
//
// 拆出来守 spec 文件 350-line cap。
// 没有 standalone upload endpoint 了 —— 所有 file 上传都是 multipart save
// 的一部分。这里只提供 "paste image 到 editor" / "选 cover image file" 的
// UI driver + admin GET 时 body_md 含 URI 的断言。

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
// 1x1 PNG。Tiptap 的 ImageUpload extension handlePaste 截获 → 分配
// pending-<id> + objectURL → 插 img 节点。真上传发生在 owner 点 submit。
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

// assertAdminBodyHasURI —— 验 admin GET /posts/ response 里那条 post 的
// body_md 含 standmeet-asset:<uuid> URI (不是 pending-xxx、不是 presigned
// URL；说明 server-side rewrite + insert assets 行都跑通了)。
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
  // 真 UUID v4 (8-4-4-4-12)；不是 pending- 前缀
  expect(post.body_md).toMatch(
    /standmeet-asset:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  );
  expect(post.body_md).not.toMatch(/standmeet-asset:pending-/);
  expect(Object.keys(post.asset_urls).length).toBeGreaterThan(0);
}
