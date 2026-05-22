// mcp-jobs-auth.spec.ts —— jobs.* tools require a valid API token.
// Mirrors mcp-auth.spec.ts pattern for the new jobs surface.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('jobs.* MCP auth', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('garbage Bearer → jobs.list_sources rejected as unauthorized',
    async ({ request }) => {
      // bad token: the streamable HTTP transport still hands the request
      // to the tool layer (mcp-go's auth hook only writes ctx; tool itself
      // sees ownerID="" and returns isError=true with "unauthorized").
      const sid = await initMCP(request, 'sms_invalid_token_xxxxxxxxxxxxxxxx');
      await expect(
        callTool(request, 'sms_invalid_token_xxxxxxxxxxxxxxxx', sid,
          'jobs.list_sources', {}),
      ).rejects.toThrow(/unauthorized/i);
    });
});
