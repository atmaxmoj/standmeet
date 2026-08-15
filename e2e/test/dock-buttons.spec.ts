// dock-buttons.spec.ts —— #109/#110 per-role chat dock 按钮：owner 在 role 上配 ≤2 个
// { 能力 + 触发词 }，冻进 session，访客 chat 渲染成按钮，点击把触发词当访客消息发出。
//
// 本 spec 覆盖 API/后端层：
//   A 配置存储 + 校验（≤2 / trigger 非空 / cap 属于 role / cap 有 title）
//   C freeze（冻进 RoleSnapshot；owner 起 session 后改不影响在跑 session）
//   D session payload + ACL 过滤（code-deny 的能力按钮不出现；disabled 的仍出现待前端置灰）
// 访客点击（E）、admin UI（F）、MCP parity（B）各自单独 spec。

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
// 共享**已登录**的 request context：admin 写（createRole / PUT）要 session cookie，
// 每个 test 各起新 context 会丢 cookie → 401。整个 file 用同一个 authed context。
let request: APIRequestContext;

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  // 先接 mail 连接器，好让 `mail.send` 真的**注册进这台实例**（它 `requires: smtp`，没连就
  // 整个隐藏）。A5 要分的正是「这个能力不存在」和「存在但这个 role 没有」这两件事：不连的话
  // 第二种情况会以第一种的理由被拒，红得不知所以然（[[red-in-the-wrong-place]]）。
  //
  // **必须排在下面那次登录之前**：它自己会登一次，把这个 context 的 CSRF 换掉 —— 反过来写的
  // 那一版，整份 spec 的写请求全部 403，看起来像 dock 的校验全崩了。
  await configureMailConnector(request, OWNER.email, OWNER.password);
  const auth = await loginAPI(request, OWNER.email, OWNER.password);
  csrf = auth.csrf;
});

test.afterAll(async () => { await request.dispose(); });

// postRole —— 直发 POST /roles 拿到裸 response（校验用；createRole fixture 遇非 201 会抛）。
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

// putRoleWithDock —— PUT 一个 role（保留其余字段）只改 dock_buttons，返状态码。C2/D4 复用。
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

  // A4 的名字说的是「role 没有的能力」，而它发的是 `no-such-capability` —— **根本不存在**的
  // 那一种。两件事被同一个名字盖住了，于是「存在、但这个 role 拿不到」那一半从没被测过，
  // 而 F-D-13 就是从那半边过去的。名字改成它实际测的东西，另一半交给 A5。
  test('A4 capability that does not exist at all → rejected', async () => {
    const res = await postRole(request, {
      name: 'a4-nonexistent', corpus_uris: [],
      dock_buttons: [{ capability_id: 'no-such-capability', trigger: 'x' }],
    });
    expect(res.status(), 'cannot dock a capability nobody registered').toBe(400);
  });

  // A5 —— F-D-13。`mail.send` 在这台实例上**是注册了的**（beforeAll 接了 mail 连接器），
  // 但它 `acl: role_granted`，而这个 role 的 skill 列表是空的 → 这个 role 的会话永远拿不到它。
  // prod 上正是这样：后台**收下**了这颗按钮、卡片上两颗都在，访客那边只出现一颗，两边都没有
  // 一句话。绑定时校验读的是 `AgentSkills.VisitorCapabilityIDs()`（全实例注册的），渲染时读的
  // 是这场会话真正拿到的能力集 —— 两个集合都叫 valid，差集就是这颗按钮。
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
      // label 透传 MCP title：非空且不是 id 兜底（无 fallback）。
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

// d4PublicPublicity —— publicRow role = 公开层（跟 corpus 公开切片一个心智）。配 dock 按钮在
// publicRow 上 → 无码 publicRow / BYOAI 访客也该拿到。
async function d4PublicPublicity(request: APIRequestContext): Promise<void> {
  const publicRow = await getRoleByName(request, 'public');
  const status = await putRoleWithDock(request, publicRow,
    [{ capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE }]);
  expect(status).toBe(200);
  const sess = await issueSession(request, { handle: OWNER.handle, mode: 'public' });
  const ids = (sess.dock_buttons ?? []).map((b) => b.capability_id);
  expect(ids, 'public/BYOAI tier inherits publicRow dock buttons').toContain(CAP_SUMMARIZE);
}
