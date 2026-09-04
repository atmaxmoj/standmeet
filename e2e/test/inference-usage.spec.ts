// inference-usage.spec.ts — #106 inference billing: every owner-key LLM call records
// {model, input/output tokens} into the inference_usage table (a 7-day window); admin
// GET /inference-usage returns the last 7 days aggregated by day × model. BYOAI is paid
// by the visitor themselves and is not billed to the owner.
//
// Red (before implementation): the endpoint 404s, no records. Green (after
// implementation): a usage row with tokens appears after an owner-key turn.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'usage-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'usageowner', fullName: 'Usage Owner',
};
const CODE = 'USE-001';

// The chart test drives the real admin UI, so adminPage logs in as this owner.
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

interface UsageRow {
  date: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}
interface UsageResp {
  rows: UsageRow[];
  total: { calls: number; input_tokens: number; output_tokens: number };
}

test.describe('inference usage billing · #106', () => {
  let csrf = '';
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    csrf = (await loginAPI(request, OWNER.email, OWNER.password)).csrf;
    const role = await createRole(request, csrf, {
      name: 'usage-role', description: 'usage', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'usage', assumed_role_id: role.id });
  });

  test.afterAll(async () => { await request.dispose(); });

  test('owner-key agent turn records token usage → admin 7-day summary shows it',
    async () => {
      // Usage over the last 7 days starts out empty.
      const before = await getUsage(request);
      expect(before.total.calls, 'no usage before any turn').toBe(0);

      // One owner-key visitor turn → goes through the mock LLM (which sends a usage frame).
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const tag = await scriptMockReplyText(request, 'Sure, here is a recap of what we discussed.');
      const turn = await request.post(`${BACKEND}/api/v1/agent/turn`, {
        headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
        data: { system: 'You are alice.', user_message: `hi${tag}`, conversation_id: sess.conversation_id },
      });
      expect(turn.status(), 'turn ok').toBe(200);

      // The admin usage endpoint: this call shows up in the last 7 days, with tokens.
      const after = await getUsage(request);
      expect(after.total.calls, 'the owner-key turn was billed').toBeGreaterThanOrEqual(1);
      expect(after.total.input_tokens, 'input tokens recorded').toBeGreaterThanOrEqual(1);
      expect(after.total.output_tokens, 'output tokens recorded').toBeGreaterThanOrEqual(1);
      expect(after.rows.length, 'at least one day×model row').toBeGreaterThanOrEqual(1);
      expect(after.rows[0]?.model, 'row carries the model').toBeTruthy();
    });

  // The owner asked for a line chart, one line per model. Runs after the turn above (serial),
  // so at least one model has usage → at least one sparkline line is drawn.
  test('the usage panel draws a per-model line chart', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'system');
    await adminPage.waitForURL('**/admin/system', { timeout: 5_000 });
    const chart = adminPage.getByTestId('inference-usage-chart');
    await expect(chart, 'the per-model chart renders').toBeVisible({ timeout: 10_000 });
    // one line per model: the billed model has its own labelled series + an SVG polyline.
    await expect(chart.locator('[data-testid^="usage-series-"]').first()).toBeVisible();
    await expect(chart.getByTestId('sparkline').first()).toBeVisible();
  });
});

async function getUsage(request: APIRequestContext): Promise<UsageResp> {
  const res = await request.get(`${BACKEND}/api/admin/inference-usage`);
  expect(res.status(), 'inference-usage endpoint 200').toBe(200);
  return await res.json() as UsageResp;
}
