// mcp-skill-grant-booking.spec.ts —— MCP↔HTTP parity: granting a built-in
// capability (calendar.book) through the MCP skill_create tool's allowed_tools.
//
// 整个 gcal booking 套件都经 HTTP admin API 授权 (POST /api/admin/skills/ 带
// allowed_tools)。而 MCP skill_create —— seed_persona.py 和「owner 用 Claude」
// 走的那条 —— 之前根本没 allowed_tools 字段,所以这条授权路径从没被测过。这里
// 补上:经 MCP 建一个 allowed_tools:["calendar.book"] 的 skill、挂到 role、发码,
// 访客 session 就暴露 calendar_book(省略 allowed_tools 则不暴露)。

import { test } from '@/fixtures/test';

import { createAPIToken } from '@/fixtures/admin';
import { expectCalendarBookExposed } from '@/fixtures/agent-skills-grant';
import {
  seedOwnerGCalConnected, teardownSeed, OWNER, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { callTool, initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';

test.describe('MCP skill_create grants calendar.book (parity with HTTP)', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerGCalConnected(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('allowed_tools:[calendar.book] via MCP → visitor session exposes calendar_book',
    async () => {
      const code = await grantViaMCP(seed, 'MCP-BOOK-YES', ['calendar.book']);
      const sess = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code, visitor_name: 'Recruiter',
      });
      await expectCalendarBookExposed(seed.request, sess.session_token, true);
    });

  test('skill without allowed_tools via MCP → calendar_book NOT exposed',
    async () => {
      const code = await grantViaMCP(seed, 'MCP-BOOK-NO', []);
      const sess = await issueSession(seed.request, {
        handle: OWNER.handle, mode: 'code', code, visitor_name: 'Recruiter',
      });
      await expectCalendarBookExposed(seed.request, sess.session_token, false);
    });
});

// grantViaMCP —— mint an MCP token, then build skill → role → code entirely via
// MCP tool calls (the owner-via-Claude path). Returns the issued code.
let seq = 0;
async function grantViaMCP(
  seed: BaseSeed, code: string, allowedTools: readonly string[],
): Promise<string> {
  seq += 1;
  const token = await createAPIToken(seed.request, seed.csrf, `mcp-grant-${seq}`);
  const sid = await initMCP(seed.request, token);
  const skill = await callTool<{ skill_id: string }>(seed.request, token, sid, 'skill_create', {
    name: `Schedule a meeting ${seq}`,
    prompt: 'Offer to book a call when the visitor wants to talk live.',
    allowed_tools: [...allowedTools],
  });
  const role = await callTool<{ role_id: string }>(seed.request, token, sid, 'role_create', {
    name: `Booking Role ${seq}`, corpus_uris: ['wiki://**'], skill_ids: [skill.skill_id],
  });
  await callTool(seed.request, token, sid, 'codes.create', {
    code, label: 'mcp grant', assumed_role_id: role.role_id,
    max_turns_per_session: 50, max_members: 10,
  });
  return code;
}
