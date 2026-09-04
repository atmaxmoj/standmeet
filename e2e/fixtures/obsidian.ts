// obsidian.ts —— shared helpers for vault import/export.

import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { login as loginAPI } from '@/fixtures/admin';

// PNG_1X1 —— a 1x1 transparent PNG, the smallest valid byte stream, same form as
// writing-assets.ts.
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

export interface UploadResult {
  created: number; updated: number; skipped: number; deleted: number; errors: string[];
}

// UploadOpts.authoritative —— mark the upload as the WHOLE vault, so notes absent from it are pruned
// (F-L-6). Mirrors the real directory-picker import (use-obsidian.ts appends the same form field).
// Default false = a partial feed the server must never delete from.
export interface UploadOpts { authoritative?: boolean }

// uploadVault —— have the browser context simulate a `<input webkitdirectory>`
// picking a set of files → triggering the import endpoint. Uploads multipart
// straight to the server, bypassing the browser file picker (playwright can't
// easily trigger the native picker).
export async function uploadVault(
  request: APIRequestContext, owner: { email: string; password: string },
  files: VaultFile[], opts: UploadOpts = {},
): Promise<UploadResult> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  // The vault-relative path goes in the form field name (= f.rel): Go multipart
  // filepath.Base's away the filename's directory, so the path can only be carried
  // by the field name; matches the real frontend (use-obsidian.ts fd.append(rel, f, rel)).
  const multipart: Record<string, { name: string; mimeType: string; buffer: Buffer } | string> = {};
  files.forEach((f) => {
    multipart[f.rel] = {
      name: f.rel.split('/').pop() ?? f.rel,
      mimeType: f.rel.endsWith('.md') ? 'text/markdown' : 'application/octet-stream',
      buffer: Buffer.from(f.body),
    };
  });
  opts.authoritative === true && (multipart['authoritative'] = 'true');
  const res = await request.post('/api/admin/obsidian/import', {
    headers: { 'X-Csrftoken': csrf },
    multipart,
  });
  expect(res.status()).toBe(200);
  return await res.json() as UploadResult;
}

// downloadExport —— fetch the export zip, return an ArrayBuffer. The caller unzips
// it with a zip lib of its own (fflate / unzipit / native ZipReader all work; this
// returns raw bytes and lets the spec decide how to inspect it).
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

// listAdminWritings —— a single simple helper.
export async function listAdminWritings(
  request: APIRequestContext, owner: { email: string; password: string },
): Promise<Array<{
  id: string; slug: string; title: string; tags: string[];
  body_md: string; published: boolean; cover_hue: string;
  cover_headline: string; cover_image_asset_id: string;
  asset_urls: Record<string, string>;
}>> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get('/api/admin/writings/', { headers: { 'X-Csrftoken': csrf } });
  return await res.json() as Array<{
    id: string; slug: string; title: string; tags: string[];
    body_md: string; published: boolean; cover_hue: string;
    cover_headline: string; cover_image_asset_id: string;
    asset_urls: Record<string, string>;
  }>;
}

// makeVaultMD —— generate a .md file string with frontmatter + body.
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
