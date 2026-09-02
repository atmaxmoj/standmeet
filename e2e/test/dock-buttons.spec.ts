// dock-buttons.spec.ts — #109/#110 per-role chat dock buttons: the owner configures ≤2
// { capability + trigger phrase } pairs on a role, they get frozen into the session, the
// visitor's chat renders them as buttons, and clicking one sends the trigger phrase as
// the visitor's message.
//
// This spec covers the API/backend layer:
//   A configuration storage + validation (≤2 / trigger non-empty / cap belongs to the
//     role / cap has a title)
//   C freeze (frozen into RoleSnapshot; changing it after the owner starts a session
//     doesn't affect the session already running)
//   D session payload + ACL filtering (a code-denied capability's button does not
//     appear; a disabled one still appears, pending frontend greying-out)
// Visitor clicks (E), admin UI (F), and MCP parity (B) each get their own separate spec.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { setCodeCapabilityDenial } from '@/fixtures/code-denials';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { configureMailConnector } from '@/fixtures/mail';
import {
  createRole, getRoleByName, type DockButtonConfig, type RoleView,
} from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'dock-buttons@example.com', password: 'correct-horse-battery-staple',
  handle: 'dockbuttons', fullName: 'Dock Buttons Owner',
};

const CAP_SUMMARIZE = 'summarize_conversation';
const CAP_RETRIEVAL = 'corpus.retrieval';
const TRIGGER_SUMMARIZE = 'Summarize our conversation so far';
const TRIGGER_RETRIEVAL = 'What have we covered?';

let csrf = '';
// A shared **logged-in** request context: admin writes (createRole / PUT) need a
// session cookie, and each test starting its own new context would lose the cookie →
// 401. The whole file uses the same authed context.
let request: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  // Connect the mail connector first, so `mail.send` actually **registers on this
  // instance** (it `requires: smtp`, and stays entirely hidden if unconnected). A5
  // needs exactly the distinction between "this capability doesn't exist" and "it
  // exists but this role doesn't have it": without connecting it, the second case gets
  // rejected for the first case's reason, red for no traceable reason
  // ([[red-in-the-wrong-place]]).
  //
  // **Must come before the login below**: that login itself logs in again and swaps out
  // this context's CSRF — done the other way around, every write request in this whole
  // spec returns 403, looking like the dock's validation is entirely broken.
  await configureMailConnector(request, OWNER.email, OWNER.password);
  const auth = await loginAPI(request, OWNER.email, OWNER.password);
  csrf = auth.csrf;
});

test.afterAll(async () => { await request.dispose(); });

// postRole — sends POST /roles directly and returns the raw response (for validation
// tests; the createRole fixture throws on anything other than 201).
async function postRole(
  request: APIRequestContext, body: Record<string, unknown>,
) {
  return request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: body['name'], description: '', greeting: '',
      prompt_id: null, corpus_uris: body['corpus_uris'] ?? ['wiki://**'],
      skill_ids: [], mcp_server_ids: [],
      dock_buttons: body['dock_buttons'] ?? [],
    },
  });
}

// putRoleWithDock — PUTs a role (keeping every other field), changing only
// dock_buttons; returns the status code. Reused by C2/D4.
async function putRoleWithDock(
  request: APIRequestContext, role: RoleView, dock: DockButtonConfig[],
): Promise<number> {
  const res = await request.put(`${BACKEND}/api/admin/roles/${role.id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: role.name, description: role.description, greeting: role.greeting,
      prompt_id: role.prompt_id ?? null, corpus_uris: role.corpus_uris,
      skill_ids: role.skill_ids, mcp_server_ids: role.mcp_server_ids,
      notify_owner: false, dock_buttons: dock,
    },
  });
  return res.status();
}

test.describe('dock buttons · A — config storage + validation', () => {
  test('A1 store ≤2 dock buttons on a role → roleView returns them', async () => {
    const role = await createRole(request, csrf, {
      name: 'a1-two-buttons', corpus_uris: ['wiki://**'],
      dock_buttons: [
        { capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE },
        { capability_id: CAP_RETRIEVAL, trigger: TRIGGER_RETRIEVAL },
      ],
    });
    expect(role.dock_buttons).toHaveLength(2);
    expect(role.dock_buttons?.[0]).toMatchObject(
      { capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE });
  });

  test('A2 more than 2 dock buttons → rejected', async () => {
    const res = await postRole(request, {
      name: 'a2-three', dock_buttons: [
        { capability_id: CAP_SUMMARIZE, trigger: 't1' },
        { capability_id: CAP_RETRIEVAL, trigger: 't2' },
        { capability_id: CAP_SUMMARIZE, trigger: 't3' },
      ],
    });
    expect(res.status(), 'at most two dock buttons').toBe(400);
  });

  test('A3 empty trigger → rejected', async () => {
    const res = await postRole(request, {
      name: 'a3-empty-trigger',
      dock_buttons: [{ capability_id: CAP_SUMMARIZE, trigger: '   ' }],
    });
    expect(res.status(), 'a dock button needs a trigger phrase').toBe(400);
  });

  // A4's name says "a capability the role doesn't have", but it actually sends
  // `no-such-capability` — the case where it **doesn't exist at all**. Two distinct
  // cases were covered by one name, so the "exists, but this role can't reach it" half
  // was never tested — and F-D-13 slipped through exactly that half. Renamed to what it
  // actually tests; the other half is A5's job.
  test('A4 capability that does not exist at all → rejected', async () => {
    const res = await postRole(request, {
      name: 'a4-nonexistent', corpus_uris: [],
      dock_buttons: [{ capability_id: 'no-such-capability', trigger: 'x' }],
    });
    expect(res.status(), 'cannot dock a capability nobody registered').toBe(400);
  });

  // A5 — F-D-13. `mail.send` **is registered** on this instance (beforeAll connected
  // the mail connector), but it carries `acl: role_granted`, and this role's skill
  // list is empty → sessions on this role can never reach it.
  // This is exactly what happens in prod: the backend **accepts** this button, both
  // buttons appear on the card, but only one shows up for the visitor, and neither side
  // says a word about it. Validation at bind time reads
  // `AgentSkills.VisitorCapabilityIDs()` (registered instance-wide), while rendering
  // reads the capability set this session actually has — both sets are called valid,
  // and this button is exactly their difference.
  test('A5 capability registered on the instance but not granted by this role → rejected',
    async () => {
      const res = await postRole(request, {
        name: 'a5-ungranted-but-real', corpus_uris: ['wiki://**'],
        dock_buttons: [{ capability_id: 'mail.send', trigger: 'email the owner about this' }],
      });
      expect(
        res.status(),
        'a button this role can never show must be refused while configuring — otherwise the '
          + 'owner leaves believing there are two buttons and the visitor gets one',
      ).toBe(400);
    });

  test('A6 clear dock buttons → roleView empty', async () => {
    const role = await createRole(request, csrf, {
      name: 'a6-clearable', corpus_uris: ['wiki://**'],
      dock_buttons: [{ capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE }],
    });
    const res = await request.put(`${BACKEND}/api/admin/roles/${role.id}`, {
      headers: { 'X-Csrftoken': csrf },
      data: {
        name: role.name, description: '', greeting: '', prompt_id: null,
        corpus_uris: ['wiki://**'], skill_ids: [], mcp_server_ids: [],
        notify_owner: false, dock_buttons: [],
      },
    });
    expect(res.status()).toBe(200);
    const updated = await res.json() as RoleView;
    expect(updated.dock_buttons ?? []).toHaveLength(0);
  });
});

test.describe('dock buttons · C — freeze into the session snapshot', () => {
  test('C2 owner edits the role after a session starts → in-flight session keeps the frozen buttons',
    async () => {
      const role = await createRole(request, csrf, {
        name: 'c2-frozen', corpus_uris: ['wiki://**'],
        dock_buttons: [{ capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE }],
      });
      const code = await createCode(request, csrf, {
        code: 'DOCK-FREEZE', label: 'freeze', assumed_role_id: role.id,
      });
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V',
      });
      expect(sess.dock_buttons).toHaveLength(1);
      expect(sess.dock_buttons?.[0]?.trigger).toBe(TRIGGER_SUMMARIZE);
      // owner changes the role's dock buttons AFTER the session was issued
      await request.put(`${BACKEND}/api/admin/roles/${role.id}`, {
        headers: { 'X-Csrftoken': csrf },
        data: {
          name: role.name, description: '', greeting: '', prompt_id: null,
          corpus_uris: ['wiki://**'], skill_ids: [], mcp_server_ids: [],
          notify_owner: false, dock_buttons: [],
        },
      });
      // a NEW session reflects the change; the old session's frozen snapshot does not.
      const fresh = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V2',
      });
      expect(fresh.dock_buttons ?? [], 'new session sees the cleared config').toHaveLength(0);
    });
});

test.describe('dock buttons · D — session payload + ACL filtering', () => {
  test('D1 payload carries the ≤2 dock buttons with id + title + trigger',
    async () => {
      const role = await createRole(request, csrf, {
        name: 'd1-payload', corpus_uris: ['wiki://**'],
        dock_buttons: [{ capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE }],
      });
      const code = await createCode(request, csrf, {
        code: 'DOCK-D1', label: 'd1', assumed_role_id: role.id,
      });
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V',
      });
      const btn = sess.dock_buttons?.[0];
      expect(btn?.capability_id).toBe(CAP_SUMMARIZE);
      expect(btn?.trigger).toBe(TRIGGER_SUMMARIZE);
      // The label passes through the MCP title: non-empty, and not falling back to
      // the id (no fallback).
      expect(btn?.title, 'title present').toBeTruthy();
      expect(btn?.title).not.toBe(CAP_SUMMARIZE);
    });

  test('D2 code denies a capability → its dock button is absent from the payload',
    async () => {
      const role = await createRole(request, csrf, {
        name: 'd2-deny', corpus_uris: ['wiki://**'],
        dock_buttons: [
          { capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE },
          { capability_id: CAP_RETRIEVAL, trigger: TRIGGER_RETRIEVAL },
        ],
      });
      const code = await createCode(request, csrf, {
        code: 'DOCK-D2', label: 'd2', assumed_role_id: role.id,
      });
      // code deny corpus.retrieval → its button must NOT render (source-level removal, not greyed).
      expect(await setCodeCapabilityDenial(request, csrf, code.id, CAP_RETRIEVAL)).toBe(201);
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V',
      });
      const ids = (sess.dock_buttons ?? []).map((b) => b.capability_id);
      expect(ids, 'denied cap button gone').not.toContain(CAP_RETRIEVAL);
      expect(ids, 'granted cap button stays').toContain(CAP_SUMMARIZE);
    });

  test('D3 capability present but disabled → button stays in payload with enabled=false (front-end greys it)',
    async () => {
      // empty corpus_uris → corpus.retrieval is visible-but-disabled (enabled=false), not denied.
      const role = await createRole(request, csrf, {
        name: 'd3-disabled', corpus_uris: [],
        dock_buttons: [{ capability_id: CAP_RETRIEVAL, trigger: TRIGGER_RETRIEVAL }],
      });
      const code = await createCode(request, csrf, {
        code: 'DOCK-D3', label: 'd3', assumed_role_id: role.id,
      });
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'V',
      });
      // button present (not denied, just disabled)…
      const ids = (sess.dock_buttons ?? []).map((b) => b.capability_id);
      expect(ids, 'disabled cap button still shown').toContain(CAP_RETRIEVAL);
      // …and its capability state is disabled → front-end greys it.
      const cap = (sess.capabilities ?? []).find((c) => c.id === CAP_RETRIEVAL);
      expect(cap?.enabled, 'empty-corpus retrieval is disabled').toBe(false);
    });

  test('D4 dock buttons on the publicRow role reach a publicRow (no-code) session — the BYOAI/publicRow tier',
    async () => {
      await d4PublicPublicity(request);
    });
});

// d4PublicPublicity — the publicRow role = the public layer (the same mental model as
// corpus's public slice). Configuring a dock button on publicRow → sessionless
// publicRow / BYOAI visitors should also get it.
async function d4PublicPublicity(request: APIRequestContext): Promise<void> {
  const publicRow = await getRoleByName(request, 'public');
  const status = await putRoleWithDock(request, publicRow,
    [{ capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE }]);
  expect(status).toBe(200);
  const sess = await issueSession(request, { handle: OWNER.handle, mode: 'public' });
  const ids = (sess.dock_buttons ?? []).map((b) => b.capability_id);
  expect(ids, 'public/BYOAI tier inherits publicRow dock buttons').toContain(CAP_SUMMARIZE);
}
