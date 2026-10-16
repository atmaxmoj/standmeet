// llm-models-and-usage.spec.ts —— BLACK BOX. The owner's MCP answers "which model does each
// feature run on" and "how much did each feature spend" (owner, 2026-10-16: "我希望owner mcp能看到
// 各个llm用量，每个功能配的都是什么模型").
//
// Found while answering: the usage table had one row per visitor turn and nothing else — the
// ghost policy call and the plugin host call (summarize_conversation's inference.generate) spent
// owner tokens that no row recorded.
//
// Contract:
//   - instance.models: the default provider, and per feature the provider/model it resolves to and
//     why (via: code > role > default; blocks → default; byoai → the visitor's own key).
//   - instance.inference_usage.by_feature: 7-day totals per feature × model. A visitor turn is
//     `chat:<role>` and carries every call the turn made (the ghost policy call too); a plugin's
//     host generation is `block:<plugin>`.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockGhost, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createProvider, listProviders, type ProviderView } from '@/fixtures/providers';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const GATEWAY = 'http://llm-gateway:9300';
const OWNER = {
  email: 'llm-models-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'llmmodels', fullName: 'LLM Models Owner',
};
const WP = {
  waypoint_id: 'grasp-alpha', description: 'understand the Alpha project', weight: 5,
  evidence_refs: ['wiki://alpha'], is_terminal: false,
};

interface Feature { feature: string; via: string; provider_label: string; model: string; codes?: number }
interface Models { default: { label: string; model: string }; features: Feature[] }
interface FeatureUsage { feature: string; model: string; calls: number; input_tokens: number; output_tokens: number }

let request: APIRequestContext;
let token = '';
let sid = '';
let dflt: ProviderView;
let second: ProviderView;

const tool = <T>(name: string): Promise<T> => callTool<T>(request, token, sid, name, {});
const feature = (m: Models, name: string): Feature | undefined => m.features.find((f) => f.feature === name);
const spent = async (name: string): Promise<FeatureUsage | undefined> =>
  (await tool<{ by_feature?: FeatureUsage[] }>('instance.inference_usage')).by_feature
    ?.find((f) => f.feature === name);

async function turn(sess: VisitorSession, msg: string): Promise<string> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { user_message: msg, conversation_id: sess.conversation_id },
  });
  expect(res.status(), 'turn ok').toBe(200);
  return res.text();
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(300_000);
  resetInstance();
  request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'llm-models');
  sid = await initMCP(request, token);
  await seedWiki(request, token, sid, { title: 'Alpha', body: 'Alpha shipped last quarter.', path: 'alpha' });
  dflt = (await listProviders(request)).find((p) => p.is_default)!;
  second = await createProvider(request, csrf, {
    label: 'second', provider: 'anthropic', endpoint: GATEWAY,
    model: 'mock-model-second', key: 'sk-second-0000000000',
  });
  const plain = await createRole(request, csrf, {
    name: 'plain-role', corpus_uris: ['wiki://**'], provider_id: second.id,
  });
  const steer = await createRole(request, csrf, {
    name: 'steer-role', corpus_uris: ['wiki://**'], waypoints: [WP],
  });
  await createCode(request, csrf, { code: 'MOD-PLAIN', label: 'plain', assumed_role_id: plain.id });
  await createCode(request, csrf, { code: 'MOD-STEER', label: 'steer', assumed_role_id: steer.id });
  await createCode(request, csrf, {
    code: 'MOD-OWN', label: 'own', assumed_role_id: steer.id, provider_id: second.id,
  });
});
test.afterAll(async () => { await request.dispose(); });

test('instance.models: each feature names the model it resolves to, and why', async () => {
  const m = await tool<Models>('instance.models');
  expect(m.default.model, 'the default provider').toBe(dflt.model);
  expect(feature(m, 'chat:plain-role'), 'a role with its own provider').toMatchObject(
    { via: 'role', provider_label: 'second', model: 'mock-model-second', codes: 1 });
  expect(feature(m, 'chat:steer-role'), 'a role without one falls to the default').toMatchObject(
    { via: 'default', provider_label: dflt.label, model: dflt.model, codes: 2 });
  expect(feature(m, 'code:MOD-OWN'), 'a code outranks its role').toMatchObject(
    { via: 'code', provider_label: 'second', model: 'mock-model-second' });
  expect(feature(m, 'code:MOD-PLAIN'), 'a code without its own provider is not listed').toBeUndefined();
  expect(feature(m, 'blocks'), 'plugins generate on the default').toMatchObject(
    { via: 'default', model: dflt.model });
  expect(feature(m, 'byoai')?.via, 'byoai runs on the visitor\'s key').toBe('visitor');
});

test('by_feature: a turn is billed to its role on its model; the ghost call is in the turn', async () => {
  const plain = await issueSession(request, { handle: OWNER.handle, code: 'MOD-PLAIN', visitor_name: 'P' });
  await turn(plain, `hello${await scriptMockReplyText(request, 'Hi there.')}`);
  const p = await spent('chat:plain-role');
  expect(p, 'billed to its role').toMatchObject({ model: 'mock-model-second', calls: 1 });

  const steer = await issueSession(request, { handle: OWNER.handle, code: 'MOD-STEER', visitor_name: 'S' });
  const ghost = await scriptMockGhost(request, {
    text: 'What made you take on Alpha?', target_waypoint: 'grasp-alpha',
    follows_from: 'you mentioned Alpha', is_bridge: false,
  });
  expect(await turn(steer, `hello${ghost}`), 'presence: the ghost call ran').toContain('event: ghost');
  const s = await spent('chat:steer-role');
  expect(s, 'billed to its role, on the default').toMatchObject({ model: dflt.model, calls: 1 });
  expect(s!.input_tokens, 'the ghost call\'s tokens are counted').toBeGreaterThan(p!.input_tokens);
});

test('by_feature: a plugin\'s host generation is billed to the plugin', async () => {
  const sess = await issueSession(request, { handle: OWNER.handle, code: 'MOD-PLAIN', visitor_name: 'B' });
  await turn(sess, `remember this${await scriptMockReplyText(request, 'Noted.')}`);
  const res = await request.post(`${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/summarize_conversation`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' }, data: {},
  });
  expect(res.status(), 'summarize ran').toBe(200);
  const rows = (await tool<{ by_feature?: FeatureUsage[] }>('instance.inference_usage')).by_feature ?? [];
  const block = rows.find((f) => f.feature.startsWith('block:'));
  expect(block, `a block row (${JSON.stringify(rows)})`).toBeTruthy();
  expect(block!.model, 'on the default provider').toBe(dflt.model);
});
