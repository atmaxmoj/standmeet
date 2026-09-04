// tool-prompts-mcp.spec.ts —— Phase E-5 MCP parity: owner CRUDs Prompts
// via MCP (Claude Code conversation), not just admin REST.
//
// Tools: prompt_create / prompt_list / prompt_delete. The publicRow builtin
// cannot be deleted (usecase intercepts, MCP returns isError).

import type { Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'prompts-mcp@example.com', password: 'correct-horse-battery-staple',
  handle: 'prompts-mcp', fullName: 'Prompts MCP Owner',
};

// seedPromptsMCP —— claim + login + API token + MCP session. Pulled into beforeAll
// to keep the describe callback < 70 lines (max-lines-per-function).
async function seedPromptsMCP(
  playwright: Playwright,
): Promise<{ sid: string; apiToken: string }> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'prompts-mcp-token');
  const sid = await initMCP(request, apiToken);
  await request.dispose();
  return { sid, apiToken };
}

// After the two faces share one payload, the row's primary key is `id` and now carries
// body —— the MCP one previously had **no body**, so an owner listing from Claude Code
// couldn't see their own text. The input param stays prompt_id: that's "which row",
// not a field on the row.
interface PromptCreateResp { id: string; name: string }
interface PromptRow {
  id: string;
  name: string;
  body?: string;
  description?: string;
  is_builtin?: boolean;
}
interface PromptDeleteResp { ok: boolean }

test.describe('Phase E-5 prompts CRUD via MCP', () => {
  let sid: string;
  let apiToken: string;

  test.beforeAll(async ({ playwright }) => {
    ({ sid, apiToken } = await seedPromptsMCP(playwright));
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
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

      const list = await callTool<PromptRow[]>(
        request, apiToken, sid, 'prompt_list', {},
      );
      const found = list.find((p) => p.id === created.id);
      expect(found?.name).toBe('recruiter-persona');
      expect(found?.description).toBe('use when visitor came via job application code');
      expect(found?.is_builtin).not.toBe(true);
      // body is here too: the MCP one previously lacked it, so an owner listing couldn't see their own text.
      expect(found?.body).toBe('You are answering as the owner to a recruiter.');

      const publicRow = list.find((p) => p.is_builtin === true);
      expect(publicRow, 'public prompt should be seeded').toBeDefined();
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
        { prompt_id: created.id },
      );
      expect(del.ok).toBe(true);
      const list = await callTool<PromptRow[]>(
        request, apiToken, sid, 'prompt_list', {},
      );
      expect(list.find((p) => p.id === created.id)).toBeUndefined();
      await request.dispose();
    });

  test('prompt_delete on builtin publicRow returns isError',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const list = await callTool<PromptRow[]>(
        request, apiToken, sid, 'prompt_list', {},
      );
      const publicRow = list.find((p) => p.is_builtin === true);
      expect(publicRow).toBeDefined();
      if (!publicRow) throw new Error('public missing');
      await expect(
        callTool(request, apiToken, sid, 'prompt_delete',
          { prompt_id: publicRow.id }),
        // After the two faces share one payload, this error's text is "cannot be renamed or deleted"
        // (one rule covers both). The assertion pins only the "builtin can't be deleted" meaning, not the whole sentence.
      ).rejects.toThrow(/builtin prompt cannot be (renamed or )?deleted/);
      await request.dispose();
    });
});
