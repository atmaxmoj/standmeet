// b5-owner-only-isolation.spec.ts —— Phase B-5: 验所有 owner-only
// capability (owner.me / seo.bundle / 后续迁入的 jobs / resume / applications
// / custom_page) 都不在 visitor session 的 capability map 或 tool_specs。
//
// 现有 registry-invariants spec 已覆盖 visitor_only ↔ no owner MCP 一侧；
// 本 spec 加强反向：枚举所有 owner-only ID + 其 OwnerMCPBinding 暴露的
// tool name，确保都没漏到 visitor 那边。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'b5@example.com', password: 'correct-horse-battery-staple',
  handle: 'b5', fullName: 'B-Five Owner',
};

const CODE = 'B5-001';

interface RegCap { id: string; shape: string }
interface RegistryListResp { capabilities: RegCap[] }
interface VisitorCap { id: string }
interface VisitorCapabilitiesResp {
  capabilities: VisitorCap[];
  tool_specs: Array<{ name: string }>;
}

test.describe('Phase B-5 owner-only capability isolation', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'b5-role', description: 'b5 spec role',
      corpus_uris: ['wiki://**', 'output://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'b5', assumed_role_id: role.id,
    });
    await request.dispose();
  });

  test('registry-list yields at least owner.me + seo.bundle as owner-only',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const ids = await fetchOwnerOnlyIDs(request);
      // B-4 落 owner.me；B-5 落 seo.bundle。后续 commit 加入更多。
      expect(ids).toContain('owner.me');
      expect(ids).toContain('seo.bundle');
      await request.dispose();
    });

  test('none of the owner-only capability IDs appear in a visitor session',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const ownerOnlyIDs = await fetchOwnerOnlyIDs(request);
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const visitorCapIDs = new Set(body.capabilities.map((c) => c.id));
      for (const id of ownerOnlyIDs) {
        expect(visitorCapIDs.has(id),
          `owner-only ${id} must not appear in visitor capability map`).toBe(false);
      }
      await request.dispose();
    });

  test('owner-side tool names absent from visitor tool_specs',
    async ({ playwright }) => {
      // owner-only tool names (e.g. 'me', 'seo.set_wiki_slug') 没理由出现
      // 在 visitor 这边。枚举几个白名单值；后续 commit 加入更多 tool 时
      // 再扩。
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const names = body.tool_specs.map((t) => t.name);
      for (const ownerTool of [
        'me', 'seo.set_wiki_slug', 'seo.update_settings',
      ]) {
        expect(names,
          `owner-only tool ${ownerTool} must not be exposed to visitor`).not.toContain(ownerTool);
      }
      await request.dispose();
    });
});

async function fetchOwnerOnlyIDs(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${BACKEND}/internal/test/registry-list`);
  if (res.status() !== 200) throw new Error(`registry-list: ${res.status()}`);
  const body = await res.json() as RegistryListResp;
  return body.capabilities.filter((c) => c.shape === 'owner_only').map((c) => c.id);
}

async function fetchVisitorCapabilities(
  request: APIRequestContext, sessionToken: string,
): Promise<VisitorCapabilitiesResp> {
  const res = await request.get(
    `${BACKEND}/internal/test/visitor-capabilities`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) {
    throw new Error(`visitor-capabilities: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as VisitorCapabilitiesResp;
}
