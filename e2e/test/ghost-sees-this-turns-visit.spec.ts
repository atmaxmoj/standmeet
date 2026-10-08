// ghost-sees-this-turns-visit.spec.ts —— the ghost after a turn knows what that turn visited.
//
// The ledger marks a waypoint visited at the end of the turn that cites its evidence, and the
// ghost policy runs after that (agent_loop.go: Done → epilogue). But the ghost read the visited
// set captured when the request started, so it was always one turn behind: it pushed the
// waypoint the answer had just covered, and after the last waypoint was visited it kept steering
// for one more turn instead of going quiet. Found on a real instance (hiring role, 2026-10-08):
// the ghost targeted `llm-reliability` again right after an answer cited its evidence.
//
// Observable without judging the model: one waypoint; a turn that reads (cites) its evidence →
// nothing is left unvisited → no ghost frame at all (the policy is not even asked). A ghost is
// scripted for that turn, so a stale visited set shows up as a ghost frame.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockGhost, scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'wp-fresh-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'wpfresh', fullName: 'Waypoint Fresh Owner',
};
const CODE = 'WPFRESH-001';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const WP = {
  waypoint_id: 'grasp-alpha', description: 'understand the Alpha project', weight: 5,
  evidence_refs: ['wiki://alpha'], is_terminal: false,
};

async function ghostFrames(request: APIRequestContext, sess: VisitorSession, msg: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { user_message: msg, conversation_id: sess.conversation_id },
  });
  expect(res.status(), 'agent/turn 200').toBe(200);
  return (await res.text()).split('\n\n').filter((f) => f.startsWith('event: ghost')).length;
}

test.beforeAll(async ({ playwright }) => { await setup(playwright); });

test('the turn that visits the last waypoint is followed by silence, not a stale ghost',
  async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });

    // Control: a turn that cites nothing — the waypoint is unvisited, the scripted ghost shows.
    const before = await scriptMockGhost(request, {
      text: 'What made you take on Alpha?', target_waypoint: WP.waypoint_id, follows_from: '', is_bridge: false,
    });
    expect(await ghostFrames(request, sess, `hello${before}`), 'unvisited → the policy steers').toBe(1);

    // The turn reads (cites) the evidence — the only waypoint is now visited. A ghost is scripted
    // again: if the policy is asked with the stale visited set, it shows.
    const read = await scriptMockToolCall(request, { name: 'corpus_read', args: { path: 'alpha' } });
    const stale = await scriptMockGhost(request, {
      text: 'Tell me more about Alpha?', target_waypoint: WP.waypoint_id, follows_from: '', is_bridge: false,
    });
    expect(await ghostFrames(request, sess, `tell me about the alpha project${read}${stale}`),
      'every waypoint visited this turn → no ghost after it').toBe(0);
    await request.dispose();
  });

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'wp-fresh-role', description: 'fresh visited spec', corpus_uris: ['wiki://**'], waypoints: [WP],
  });
  await createCode(request, csrf, { code: CODE, label: 'wpfresh', assumed_role_id: role.id });
  const apiToken = await createAPIToken(request, csrf, 'wpfresh-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, { title: 'Alpha', body: 'Alpha shipped last quarter.', path: 'alpha' });
  await request.dispose();
}
