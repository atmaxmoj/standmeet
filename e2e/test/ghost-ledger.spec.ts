// ghost-ledger.spec.ts —— Ghost steering P2: WaypointLedger's mechanical visited marking (α≈0, no LLM judge).
//
// Design ([[ghost-steering]]): a waypoint's "visit" is a **mechanical fact**, not an LLM judgment:
//   • evidence waypoint —— this turn's assistant **citation** (corpus_read) touches its evidence_refs → visited;
//   • action/terminal waypoint —— a **tool event** (calendar_book booked) → visited.
// The ledger hangs off the redis visitor_session. Observation point: waypoints[].visited on /internal/diag/session.
//
// RED (before implementation): no ledger, diag waypoints have no visited field → baseline cannot even read it, and it does not flip after a citation.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'wp-ledger-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'wpledger',
  fullName: 'Waypoint Ledger Owner',
};
const CODE = 'WPLEDGER-001';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// Evidence note: title 'Alpha' → path 'alpha' → URI wiki://alpha. The waypoint's evidence_ref points at it.
const EVIDENCE_TITLE = 'Alpha';
const EVIDENCE_PATH = 'alpha';
const EVIDENCE_URI = 'wiki://alpha';

const WP_EVIDENCE = {
  waypoint_id: 'grasp-alpha',
  description: 'understand the Alpha project',
  weight: 5,
  evidence_refs: [EVIDENCE_URI],
  is_terminal: false,
};

interface SnapshotWaypoint {
  waypoint_id: string;
  visited: boolean;
}

async function waypointVisited(
  request: APIRequestContext, sessionToken: string, id: string,
): Promise<boolean | undefined> {
  const res = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': sessionToken },
  });
  expect(res.status(), 'diag/session 200').toBe(200);
  const body = await res.json() as { waypoints?: SnapshotWaypoint[] };
  return (body.waypoints ?? []).find((w) => w.waypoint_id === id)?.visited;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

let owner: { request: APIRequestContext; sid: string } | null = null;

test.beforeAll(async ({ playwright }) => {
  owner = await setupOwner(playwright);
});

test.afterAll(async () => {
  await owner?.request.dispose();
});

test.describe('waypoint ledger · citation → visited · P2', () => {
  test('baseline:开局 evidence waypoint 未访问', async ({ playwright }) => {
    const sess = await freshSession(playwright);
    expect(
      await waypointVisited(sess.request, sess.token, WP_EVIDENCE.waypoint_id),
      '发码开局 waypoint 应存在且 visited=false',
    ).toBe(false);
  });

  test('assistant 引用命中 evidence_refs → 该 waypoint 翻 visited', async ({ playwright }) => {
    const sess = await freshSession(playwright);
    // Scripted: next turn the assistant first corpus_reads the evidence note (producing a citation), then answers.
    const tag = await scriptMockToolCall(sess.request, {
      name: 'corpus_read', args: { path: EVIDENCE_PATH },
    });
    await sendAndDrain(sess.request, sess.session, `tell me about the alpha project${tag}`);

    expect(
      await waypointVisited(sess.request, sess.token, WP_EVIDENCE.waypoint_id),
      '引用触到 evidence_refs 后 waypoint = visited',
    ).toBe(true);
  });
});

interface Sess { request: APIRequestContext; session: VisitorSession; token: string }

async function freshSession(playwright: Playwright): Promise<Sess> {
  const request = await playwright.request.newContext();
  const session = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  return { request, session, token: session.session_token };
}

async function setupOwner(playwright: Playwright): Promise<{ request: APIRequestContext; sid: string }> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'wp-ledger-role', description: 'ledger spec',
    corpus_uris: ['wiki://**'], waypoints: [WP_EVIDENCE],
  });
  await createCode(request, csrf, { code: CODE, label: 'wpledger', assumed_role_id: role.id });
  // Seed the evidence note (written via owner MCP) so corpus_read has something to read and cite. path 'alpha' → URI wiki://alpha.
  const apiToken = await createAPIToken(request, csrf, 'wpledger-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    title: EVIDENCE_TITLE, body: 'Alpha shipped last quarter.', path: EVIDENCE_PATH,
  });
  return { request, sid };
}
