// mcp-skill-grant-booking.spec.ts —— MCP↔HTTP parity: granting a built-in
// capability (calendar.book) through the MCP skill_create tool's allowed_tools.
//
// The entire gcal booking suite grants access through the HTTP admin API (POST
// /api/admin/skills/ with allowed_tools). But MCP skill_create — the path seed_persona.py and
// "the owner working through Claude" actually use — previously had no allowed_tools field at all,
// so this grant path had never been tested. This fills that gap: build a skill with
// allowed_tools:["calendar.book"] via MCP, attach it to a role, issue a code, and the visitor
// session should expose calendar_book (omitting allowed_tools should not expose it).

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
  const skill = await callTool<{ id: string }>(seed.request, token, sid, 'skill_create', {
    name: `Schedule a meeting ${seq}`,
    prompt: 'Offer to book a call when the visitor wants to talk live.',
    allowed_tools: [...allowedTools],
  });
  // The primary key is called `id` — after the two surfaces were unified onto one payload, MCP's
  // own private `role_id` field went away. Reading the wrong key fails silently: assumed_role_id
  // gets undefined, the code still gets created, just without a role, so "the tool that was
  // granted access" quietly vanishes. This case used to go red for exactly that reason.
  const role = await callTool<{ id: string }>(seed.request, token, sid, 'role_create', {
    name: `Booking Role ${seq}`, corpus_uris: ['wiki://**'], skill_ids: [skill.id],
  });
  await callTool(seed.request, token, sid, 'codes.create', {
    code, label: 'mcp grant', assumed_role_id: role.id,
    max_turns_per_session: 50, max_members: 10,
  });
  return code;
}
