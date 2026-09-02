// sdk-turn-is-the-product.spec.ts —— F-O-2. **The SDK that actually ships** must take
// a conversation turn through the product's own path, not a retired bare proxy.
//
// How this was found in the real environment: dropping the built embed onto a
// **cross-origin** page (`localhost:41999` pointing at `38227`), asking "what is this
// corpus for?", and getting back *"This corpus is designed to provide textual data for
// training, testing, and evaluating natural language processing models."* — an NLP
// textbook definition with nothing to do with the owner's 1,010 pieces of corpus or
// their voice.
//
// The cause, in code: `sdk/packages/core/src/client.ts`'s `streamMessage` hits
// `POST /api/v1/llm/chat/stream` with **`system: ''`** in the body, and its own comment
// says *"No tool loop; this is a single-turn smoke test path"* — while
// `backend/.../public/chat.go:109-110` says that path is **retired** once the SDK
// switched to `/agent/turn`. The app's own page switched over long ago — this round's
// fixes to persona, the skill list, the truncation notice, the claim gate all live on
// the new path — but the SDK's half never followed.
//
// **This spec drives the actual shipped client** (`@standmeet/core`'s `createClient`),
// not a fetch I wrote to imitate it — rewriting it myself would keep this green even
// after the real implementation changed ([[test-covers-capability-not-face]]).
//
// The criterion borrows the F-A-36 trick: the mock gateway echoes the system prompt it
// receives verbatim back into the answer, so "a sentence that can only come from the
// owner's persona" appearing in the answer means that persona genuinely reached the
// model. On the empty-system path, it cannot appear.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';
// Dynamic import: this package is ESM-only (no require condition in exports), while
// Playwright loads specs as CJS. **What matters is the shipped package itself**, so a
// dynamic import wins over writing a stand-in fetch that imitates it.

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'sdkturn@example.com',
  password: 'sdk-turn-is-the-product-1',
  handle: 'sdkturnowner',
  fullName: 'SDK Turn Owner',
};

const CODE = 'SDKTURN-01';
// A sentence that can only come from the role persona — it isn't in the corpus, and
// it isn't in any generic header.
const PERSONA_MARK = 'ALWAYS-NAME-THE-LEDGER-FIRST';
const ROLE = 'sdk-persona-carrier';

test.describe('F-O-2 · a turn taken through the shipped SDK is the product', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance can take ~48s under load
    await initOwner(playwright);
  });

  test('the owner persona reaches the model on the SDK path, not just the app path',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const tag = await scriptMockReplyText(request, 'noted.');

      // The real client, pointed at the instance's absolute address — exactly how the
      // embed on a third-party site would use it.
      const { createClient } = await import('@standmeet/sdk-core');
      const client = createClient({ baseURL: appBaseURL() });
      const session = await client.issueSession({
        mode: 'code', code: CODE, visitor_name: 'Embedded Reader',
      });

      // The exact same two steps as the embed: first assemble the system prompt
      // (fragment + persona) for this session, then use it to take a turn. Skipping
      // the first step means the model gets an empty system prompt — exactly the
      // shape of F-O-2.
      const system = await client.composeSystem(session);
      let answer = '';
      for await (const ev of client.streamMessage(
        session.conversation_id, session.session_token, `hello ${tag}`, system,
      )) {
        if (ev.kind === 'token') answer += ev.text;
      }

      expect(answer, 'the SDK turn produced text at all').not.toBe('');
      expect(answer,
        'the persona the owner wrote reached the model through the SDK path')
        .toContain(PERSONA_MARK);
      await request.dispose();
    });

  // F-O-7 —— the second turn must carry the first turn along with it.
  //
  // How this was found in the real environment: asking two questions in a row on a
  // cross-origin page, and having "he"/"it" in the second question answered with
  // *"this is the first thing I've seen in our exchange"*. **Confirmed by reading the
  // code**: `client.ts`'s request body hardcodes `history: []`, while the backend
  // assembles the model's message history from `req.History` — it never backfills by
  // conversation_id.
  //
  // This criterion doesn't look at the answer — the KV stand-in's reply is scripted,
  // so the answer text can't tell you whether it "remembers" anything. Instead it
  // looks at **what the client actually sent**: inject a custom fetch (`createClient`
  // already accepts a `fetchImpl`) and keep the request bodies. Red state: the second
  // request's `history` is an empty array.
  test('the second turn carries the first — the shipped client is not memoryless',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const first = await scriptMockReplyText(request, 'Lucerna, a reading app.');
      const second = await scriptMockReplyText(request, 'Noted.');

      const bodies: string[] = [];
      const { createClient } = await import('@standmeet/sdk-core');
      const client = createClient({
        baseURL: appBaseURL(),
        fetchImpl: async (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL
            ? input.href : input.url;
          if (url.includes('/agent/turn') && typeof init?.body === 'string') {
            bodies.push(init.body);
          }
          return fetch(input, init);
        },
      });
      const session = await client.issueSession({ mode: 'code', code: CODE });
      const system = await client.composeSystem(session);
      const ask = async (text: string): Promise<void> => {
        for await (const _ of client.streamMessage(
          session.conversation_id, session.session_token, text, system,
        )) { /* drain */ }
      };
      await ask(`what did the owner ship${first}`);
      await ask(`and what did he learn from it${second}`);

      expect(bodies, 'both turns went out').toHaveLength(2);
      const sent = JSON.parse(bodies[1] ?? '{}') as {
        history?: { role: string; content: string }[];
      };
      const hist = sent.history ?? [];
      expect(hist.length, '第二轮必须带着第一轮的问与答').toBeGreaterThanOrEqual(2);
      expect(hist.map((m) => `${m.role}:${m.content}`).join(' | '),
        '第一轮的问题在历史里')
        .toContain('what did the owner ship');
      expect(hist.map((m) => m.content).join(' | '), '第一轮的答案也在历史里')
        .toContain('Lucerna');
      await request.dispose();
    });
});

// appBaseURL —— use 127.0.0.1, not localhost: Node resolves that to ::1 first, while
// the port only listens on IPv4, so fetch gets a straight ECONNREFUSED (a browser
// wouldn't do this, so this bite is specific to the Node-side spec).
function appBaseURL(): string {
  return (process.env['BASE_URL'] ?? 'http://localhost:38127')
    .replace('localhost', '127.0.0.1');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'sdk-turn-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'the ledger is where the work is recorded.', title: 'Ledger',
  });
  const roleID = await createRoleWithPersona(request, csrf);
  await createCode(request, csrf, { code: CODE, label: 'SDK', assumed_role_id: roleID });
  await request.dispose();
}

// createRoleWithPersona —— a role carrying a prompt body, the same thing the owner
// does on /admin/prompts + /admin/roles.
async function createRoleWithPersona(
  request: APIRequestContext, csrf: string,
): Promise<string> {
  const backend = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
  const p = await request.post(`${backend}/api/admin/prompts`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name: 'sdk-persona-body', body: `${PERSONA_MARK}. Speak plainly.` },
  });
  if (!p.ok()) throw new Error(`create prompt failed: ${p.status()}`);
  const prompt = await p.json() as { id: string };
  const r = await request.post(`${backend}/api/admin/roles`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: ROLE, description: 'carries a persona', greeting: '',
      prompt_id: prompt.id, corpus_uris: ['wiki://**'],
      skill_ids: [], mcp_server_ids: [], dock_buttons: [], waypoints: [],
    },
  });
  if (!r.ok()) throw new Error(`create role failed: ${r.status()}`);
  const role = await r.json() as { id: string };
  return role.id;
}
