// connector-err-chain-steps.spec.ts —— §四 错误流矩阵 E3 / E4 / E5
// 链路 `装配解析 → Connected? → 注入句柄 → tool call → proxy → 解密 → 外部`
// 上靠近 host 那几步的失败:句柄构建失败(E3)、plugin→host socket 不可达(E4)、
// vault 解密失败(E5)。每一步崩都应**友好降级**:HTTP 不是 500、无 panic/goroutine/
// stack、且(E5)错误里**绝不带密**。
//
// Error stream E3/E4/E5: faults near the host edge of the connector chain —
// handle construction failure (E3), an unreachable plugin→host socket mid-call
// (E4), and a vault decrypt failure (E5) — must each degrade to a friendly
// result: status < 500, no panic/goroutine/stack leak, and (E5) NO secret /
// plaintext in the response.
//
// RED / TDD：依赖 connector 注入层把这三处 host-edge 故障各自映射成友好降级落地后转绿。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface ToolResp {
  ok?: boolean;
  reason?: string;
  result?: { error?: string };
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

// TODO(impl): needs a host-side connector fault toggle — no helper exists yet.
// Raw POST so the spec COMPILES; these target an in-host fault-injection mock
// endpoint (NOT the Google/SMTP mock) the refactor will add, so a specific
// chain step can be made to fail exactly once. step ∈ handle-build | socket | decrypt.
async function failConnectorChainStep(
  request: APIRequestContext, step: 'handle-build' | 'socket' | 'decrypt',
): Promise<void> {
  await request.post(`${BACKEND}/__mock/connector/fail`, {
    data: { step, times: 1 },
  });
}

async function callBook(
  request: APIRequestContext, convID: string, token: string, topic: string,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/calendar_book`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { topic, duration_min: 30, preferred_times: [future(7, 14)] },
    },
  );
  return { status: res.status(), body: await res.json() as ToolResp };
}

async function newCodeSession(
  request: APIRequestContext, seed: CodedSeed,
): Promise<{ conversation_id: string; session_token: string }> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, mode: 'code', code: seed.code.code, visitor_name: 'V',
  });
  return { conversation_id: sess.conversation_id, session_token: sess.session_token };
}

test.describe('connector error stream · host-edge chain failures degrade (E3/E4/E5)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  // E3 注入: dep 解析出来了但句柄构建失败 → 能力隐藏 / tool 友好错误。
  test('E3 handle-build fail → capability hidden / tool errors friendly, no 500, no stack',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await failConnectorChainStep(request, 'handle-build');

      const sess = await newCodeSession(request, seed);
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token, 'E3 handle build');

      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly degrade hint')
        .toMatch(/calendar|unavailable|again|later|couldn'?t/i);
      expect(msg, 'no raw stack trace').not.toMatch(/panic|goroutine|stack/i);

      await request.dispose();
    });

  // E4 proxy: plugin→host connector op socket mid-call 不可达 → 友好降级(非 500/stack)。
  test('E4 socket unreachable mid-call → friendly degrade, not a 500/stack',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await failConnectorChainStep(request, 'socket');

      const sess = await newCodeSession(request, seed);
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token, 'E4 socket');

      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly degrade hint')
        .toMatch(/calendar|unavailable|again|later|couldn'?t/i);
      expect(msg, 'no raw socket / stack leak')
        .not.toMatch(/panic|goroutine|stack|dial unix|no such file|connection refused/i);

      await request.dispose();
    });

  // E5 解密: 加密凭据解密失败(corrupt / key mismatch)→ 友好降级 AND 错误里无密/明文。
  test('E5 vault decrypt fail → friendly degrade, response contains NO secret/plaintext',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await failConnectorChainStep(request, 'decrypt');

      const sess = await newCodeSession(request, seed);
      const { status, body } = await callBook(request, sess.conversation_id, sess.session_token, 'E5 decrypt');

      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''}`;
      expect(msg, 'friendly degrade hint')
        .toMatch(/calendar|unavailable|again|later|couldn'?t/i);
      expect(msg, 'no raw stack trace').not.toMatch(/panic|goroutine|stack/i);
      // load-bearing: a decrypt failure must NOT spill the plaintext secret / key material.
      expect(msg, 'no secret / plaintext leak')
        .not.toMatch(/mock-gcal-client-secret|client_secret|refresh_token|access_token|BEGIN .*KEY|cipher|nonce/i);

      await request.dispose();
    });
});
