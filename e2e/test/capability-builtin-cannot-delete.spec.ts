// capability-builtin-cannot-delete.spec.ts —— Phase H / P.6：存在性（existence）
// 由 Origin 决定。删除按钮**只对 owner-origin 亮** —— builtin/managed 删不掉
// （但能关，见 capability-enable-disable）。owner-origin（owner 自己 author 的
// skill / 注册的 MCP server）有完整删除入口。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import {
  listCapabilities, findCapability, deleteCapability,
} from '@/fixtures/capabilities';

const OWNER = {
  email: 'cap-del@example.com', password: 'correct-horse-battery-staple',
  handle: 'capdel', fullName: 'Cap Del Owner',
};

const BUILTIN_ID = 'corpus.retrieval';

let csrf = '';

test.describe('Phase H · existence is Origin-controlled (delete only owner-origin)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    // owner-authored skill → an owner-origin entry that IS deletable.
    const token = await createAPIToken(request, csrf, 'cap-del-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'skill_create', {
      name: 'owner-thing', description: 'an owner-origin capability',
      prompt: 'owner instructions',
    });
    await request.dispose();
  });

  test('builtin corpus.retrieval → deletable:false AND DELETE is rejected',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const cap = await findCapability(request, csrf, BUILTIN_ID);
      expect(cap?.origin).toBe('builtin');
      expect(cap?.deletable, 'builtin not deletable').toBe(false);
      // hard guard: even a direct DELETE must be refused (>=400), not silently no-op.
      expect(await deleteCapability(request, csrf, BUILTIN_ID)).toBeGreaterThanOrEqual(400);
      await request.dispose();
    });

  test('owner-origin entry → deletable:true AND DELETE removes it',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // find the owner-origin row by its origin (don't hardcode the id scheme).
      const ownerRow = (await listCapabilities(request, csrf)).find((c) => c.origin === 'owner');
      expect(ownerRow, 'an owner-origin capability exists').toBeDefined();
      expect(ownerRow?.deletable, 'owner-origin deletable').toBe(true);

      const status = await deleteCapability(request, csrf, ownerRow!.id);
      expect(status, 'delete succeeds').toBeGreaterThanOrEqual(200);
      expect(status).toBeLessThan(300);

      // gone from the list.
      expect((await listCapabilities(request, csrf)).some((c) => c.id === ownerRow!.id))
        .toBe(false);
      await request.dispose();
    });
});
