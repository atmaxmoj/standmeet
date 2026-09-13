// active-only-self-made-fiber.spec.ts — everything-is-a-block cross-cutting:
// an agent sees only ACTIVE fibers, and a self-authored fiber behaves like any other.
//
// block-disable-while-attached.spec already proves this for a BUILT-IN fiber (calendar.book):
// the owner's off-switch beats the ACL. This covers the case the owner called out as
// "different when it's self-made" — an owner-authored skill (a self-made fiber): granted by a
// role, it enters the session; disabled, it is gone; re-enabled, it returns. Meanwhile a
// built-in fiber the same session was granted (corpus retrieval) is untouched — toggling the
// self-made fiber changes only its own tools, nothing else.
//
// Anchored, not a bare absence assertion: skill_use is asserted PRESENT first, so the later
// absence is a real state change (present → disable → absent → enable → present), and the
// built-in anchor (corpus_search) is asserted present throughout.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { sessionToolNames } from '@/fixtures/blocks';

const OWNER = {
  email: 'active-only@example.com', password: 'correct-horse-battery-staple',
  handle: 'activeonly', fullName: 'Active-Only Owner',
};
const CODE = 'ACTIVEONLY-001';

const SKILL = {
  name: 'active-only-skill',
  description: 'fixture: a self-made fiber',
  prompt: 'Always begin replies with [ACTIVE-ONLY-MARKER].',
  scripts: [{
    filename: 'marker.sh', language: 'bash',
    content: 'echo "[ACTIVE-ONLY-SCRIPT]"',
    description: 'skill.runner needs a script to expose its generic tools.',
  }],
};

test.describe('an agent sees only active fibers (self-made fiber)', () => {
  test('a self-authored skill: granted→present, disabled→gone, re-enabled→back; built-in untouched',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      resetInstance();
      await claim(request, findSetupToken(), {
        email: OWNER.email, password: OWNER.password,
        handle: OWNER.handle, fullName: OWNER.fullName,
      });
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const apiToken = await createAPIToken(request, csrf, 'active-only-token');
      const sid = await initMCP(request, apiToken);

      const skill = await callTool<{ id: string }>(request, apiToken, sid, 'skill_create', SKILL);
      const role = await createRole(request, csrf, {
        name: 'active-only-role',
        description: 'fixture: self-made skill + built-in corpus',
        corpus_uris: ['wiki://**', 'output://**'],
        skill_ids: [skill.id],
        mcp_server_ids: [],
      });
      await createCode(request, csrf, {
        code: CODE, label: 'active only', assumed_role_id: role.id,
      });

      // Active-only is decided when a session is ASSEMBLED: a role's enabled-skill set is
      // baked into the visitor role snapshot at issue (visitor_role_snapshot.go), and the
      // skill.runner fiber is hidden unless the role has ≥1 enabled granted skill
      // (skill_runner.go). So each toggle is observed by issuing a FRESH session — unlike a
      // block's live off-switch (block-disable-while-attached), which bites an open session.
      const issue = async (): Promise<string[]> => {
        const s = await issueSession(request, {
          handle: OWNER.handle, code: CODE, visitor_name: 'Inspector',
        });
        return sessionToolNames(request, s.session_token);
      };

      // Present: the self-made fiber is in the session; the built-in anchor is too.
      const before = await issue();
      expect(before, 'self-made skill fiber present when active').toContain('skill_use');
      expect(before, 'built-in corpus fiber present').toContain('corpus_search');

      // Disable the self-made fiber (globally). Its runner must leave the agent even though the
      // role still grants it — the off-switch beats the ACL.
      await callTool(request, apiToken, sid, 'skill_set_enabled',
        { skill_id: skill.id, enabled: false });
      const disabled = await issue();
      expect(disabled, 'disabled self-made fiber is gone from the agent').not.toContain('skill_use');
      // The built-in fiber is untouched: toggling the self-made one changed only its own tools.
      expect(disabled, 'built-in fiber unaffected by disabling a different fiber')
        .toContain('corpus_search');

      // Re-enable → it returns (proves the absence above was the toggle, not a broken session).
      await callTool(request, apiToken, sid, 'skill_set_enabled',
        { skill_id: skill.id, enabled: true });
      const reenabled = await issue();
      expect(reenabled, 're-enabled self-made fiber returns').toContain('skill_use');

      await request.dispose();
    });
});
