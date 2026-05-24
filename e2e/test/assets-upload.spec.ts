// assets-upload.spec.ts —— owner 通过 admin upload PNG → public 拿
// presigned URL → 下载 bytes 完整匹配。
//
// 业务故事：
//   后续 blog post 封面、raw 附件、custom page 资源都走 MinIO；这条 e2e
//   保证 storage 层端到端 (admin multipart → backend → MinIO → public
//   /api/v1/assets/{id} → presign 302 → 客户端 GET → 原 bytes) 全链通。

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import type { APIRequestContext } from '@playwright/test';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

// 一段最小合法 PNG (1×1 transparent) 的 base64。
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');

test.describe.serial('owner-uploaded assets land in MinIO + are fetchable via public URL', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('admin uploads PNG → /api/v1/assets/{id} 302 → bytes match',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const asset = await uploadPNG(request, csrf);
      expect(asset.id).toBeTruthy();
      expect(asset.url).toContain('localhost:9200');
      // public route: redirect-follow 拿 bytes
      const fetched = await request.get(
        `http://localhost:8000/api/v1/assets/${asset.id}`,
        { maxRedirects: 5 },
      );
      expect(fetched.status()).toBe(200);
      const body = await fetched.body();
      expect(body.equals(PNG_BYTES)).toBe(true);
    });
});

interface UploadedAssetResp {
  id: string;
  url: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
}

async function uploadPNG(
  request: APIRequestContext, csrf: string,
): Promise<UploadedAssetResp> {
  const res = await request.post('http://localhost:8000/api/admin/assets/', {
    headers: { 'X-Csrftoken': csrf },
    multipart: {
      file: {
        name: 'pixel.png',
        mimeType: 'image/png',
        buffer: PNG_BYTES,
      },
    },
  });
  if (res.status() !== 201) {
    throw new Error(`upload failed: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as UploadedAssetResp;
}

