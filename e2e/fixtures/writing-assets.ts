// writing-assets.ts —— image / asset helpers shared by the writings specs.
//
// Split out to keep spec files under the 350-line cap.
// There's no standalone upload endpoint anymore —— every file upload is part of the multipart
// save. This only provides UI drivers for "paste an image into the editor" / "pick a cover image file"
// + an assertion that admin GET's body_md contains the URI.

import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';

// PNG_1X1 —— a 1x1 transparent PNG, the smallest valid PNG byte stream. Shared by all image upload tests.
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
  await page.getByTestId('writing-field-cover-image').setInputFiles({
    name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1X1),
  });
}

// pasteImage —— dispatch a ClipboardEvent on the contenteditable, with files carrying
// a 1x1 PNG. Tiptap's ImageUpload extension handlePaste intercepts it → assigns
// pending-<id> + objectURL → inserts an img node. The real upload happens when the owner clicks submit.
export async function pasteImage(page: Page, filename: string): Promise<void> {
  await page.evaluate(({ name, bytes }) => {
    const editor = document.querySelector('[data-testid="writing-field-body"]');
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

// assertAdminBodyHasURI —— verify that in the admin GET /writings/ response, that writing's
// body_md contains a standmeet-asset:<uuid> URI (not pending-xxx, not a presigned
// URL; proving the server-side rewrite + insert-assets rows all ran).
export async function assertAdminBodyHasURI(
  request: APIRequestContext, owner: OwnerCreds, slug: string,
): Promise<void> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get('/api/admin/writings/', {
    headers: { 'X-Csrftoken': csrf },
  });
  const writings = await res.json() as Array<{
    slug: string; body_md: string; asset_urls: Record<string, string>;
  }>;
  const writing = writings.find((p) => p.slug === slug);
  if (!writing) throw new Error(`${slug} not in admin list`);
  // a real UUID v4 (8-4-4-4-12); not the pending- prefix
  expect(writing.body_md).toMatch(
    /standmeet-asset:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  );
  expect(writing.body_md).not.toMatch(/standmeet-asset:pending-/);
  expect(Object.keys(writing.asset_urls).length).toBeGreaterThan(0);
}
