// b6-codes-revoke-mcp.spec.ts —— Phase B-6 parity pilot: codes.revoke via
// MCP works; revoked code blocks subsequent visitor turns (complements IAM A.3-IAM-6's
// iam-revoke-blocks-next-turn -- that one goes through admin REST, this one through MCP).
//
// Business story:
//   the owner, in Claude Code, notices a visitor abusing a code and tells the AI
//   "revoke B6-001". The AI calls codes.revoke({code_id:...}) -> MCP adapter -> CodeRepo
//   .Revoke -> DB status='revoked'. The same visitor session's next turn gets a 401.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'b6@example.com', password: 'correct-horse-battery-staple',
  handle: 'b6', fullName: 'B-Six Owner',
};

const CODE = 'B6-001';

interface CodeView { id: string; code: string; status: string }
type ListCodesResp = CodeView[];

test.describe('Phase B-6 codes.revoke via MCP parity', () => {
  let codeRecord: CodeView;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'b6-role', description: 'b6 spec',
      corpus_uris: ['wiki://**', 'output://**'],
    });
    const createRes = await request.post(`${BACKEND}/api/admin/codes/`, {
      headers: { 'X-Csrftoken': csrf },
      data: {
        code: CODE, label: 'b6 spec',
        ghosts: [], assumed_role_id: role.id,
      },
    });
    if (createRes.status() !== 201) {
      throw new Error(`create code: ${createRes.status()}`);
    }
    codeRecord = await createRes.json() as CodeView;
    await request.dispose();
  });

  test('owner revokes code via MCP; visitor next turn blocked',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // 1) visitor starts a session + runs 1 turn ok
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const okRes = await sendMessage(request, sess, 'hi');
      expect(okRes.status()).toBe(200);
      await okRes.body();

      // 2) owner calls codes.revoke through MCP
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'b6-mcp-token');
      const sid = await initMCP(request, apiToken);
      const revokeResp = await callTool<{ code_id: string; revoked: boolean }>(
        request, apiToken, sid, 'codes.revoke', { code_id: codeRecord.id },
      );
      expect(revokeResp.revoked).toBe(true);
      expect(revokeResp.code_id).toBe(codeRecord.id);

      // 3) visitor's next turn is rejected
      const blockedRes = await sendMessage(request, sess, 'still there?');
      expect(blockedRes.status()).toBeGreaterThanOrEqual(400);

      // 4) verify status='revoked' via admin /codes/ list
      const listRes = await request.get(`${BACKEND}/api/admin/codes/`, {
        headers: { 'X-Csrftoken': csrf },
      });
      if (listRes.status() !== 200) throw new Error(`list codes: ${listRes.status()}`);
      const codes = await listRes.json() as ListCodesResp;
      const revoked = codes.find((c) => c.id === codeRecord.id);
      expect(revoked?.status).toBe('revoked');

      await request.dispose();
    });

  test('codes.revoke with invalid code_id returns error result',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'b6-mcp-token-2');
      const sid = await initMCP(request, apiToken);
      // calling a fake uuid -> mcp-go returns isError=true, callTool throws
      await expect(
        callTool(request, apiToken, sid, 'codes.revoke', {
          code_id: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow(/code not found|revoke failed/);
      await request.dispose();
    });
});

