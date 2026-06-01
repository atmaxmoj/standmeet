// tool-prompts-mcp.spec.ts —— Phase E-5 MCP parity: owner CRUDs Prompts
// via MCP (Claude Code conversation), not just admin REST。
//
// Tools: prompt_create / prompt_list / prompt_delete。vanilla builtin
// 不可删 (usecase 拦截，MCP 返 isError)。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'prompts-mcp@example.com', password: 'correct-horse-battery-staple',
  handle: 'prompts-mcp', fullName: 'Prompts MCP Owner',
};

interface PromptCreateResp { prompt_id: string; name: string }
interface PromptRow {
  prompt_id: string;
  name: string;
  description?: string;
  is_builtin?: boolean;
}
interface PromptDeleteResp { ok: boolean }

test.describe('Phase E-5 prompts CRUD via MCP', () => {
  let sid: string;
  let apiToken: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    apiToken = await createAPIToken(request, csrf, 'prompts-mcp-token');
    sid = await initMCP(request, apiToken);
    await request.dispose();
  });

  test('prompt_create + prompt_list returns the new prompt with metadata',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const created = await callTool<PromptCreateResp>(
        request, apiToken, sid, 'prompt_create',
        {
          name: 'recruiter-persona',
          body: 'You are answering as the owner to a recruiter.',
          description: 'use when visitor came via job application code',
        },
      );
      expect(created.name).toBe('recruiter-persona');
      expect(created.prompt_id).toMatch(/^[0-9a-f-]{36}$/);

      const list = await callTool<PromptRow[]>(
        request, apiToken, sid, 'prompt_list', {},
      );
      const found = list.find((p) => p.prompt_id === created.prompt_id);
      expect(found?.name).toBe('recruiter-persona');
      expect(found?.description).toBe('use when visitor came via job application code');
      expect(found?.is_builtin).not.toBe(true);

      const vanilla = list.find((p) => p.is_builtin === true);
      expect(vanilla, 'vanilla prompt should be seeded').toBeDefined();
      await request.dispose();
    });

  test('prompt_delete on non-builtin removes it from prompt_list',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const created = await callTool<PromptCreateResp>(
        request, apiToken, sid, 'prompt_create',
        { name: 'to-delete', body: 'temporary persona' },
      );
      const del = await callTool<PromptDeleteResp>(
        request, apiToken, sid, 'prompt_delete',
        { prompt_id: created.prompt_id },
      );
      expect(del.ok).toBe(true);
      const list = await callTool<PromptRow[]>(
        request, apiToken, sid, 'prompt_list', {},
      );
      expect(list.find((p) => p.prompt_id === created.prompt_id)).toBeUndefined();
      await request.dispose();
    });

  test('prompt_delete on builtin vanilla returns isError',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const list = await callTool<PromptRow[]>(
        request, apiToken, sid, 'prompt_list', {},
      );
      const vanilla = list.find((p) => p.is_builtin === true);
      expect(vanilla).toBeDefined();
      if (!vanilla) throw new Error('vanilla missing');
      await expect(
        callTool(request, apiToken, sid, 'prompt_delete',
          { prompt_id: vanilla.prompt_id }),
      ).rejects.toThrow(/builtin prompt cannot be deleted/);
      await request.dispose();
    });
});
