// assistant-cue.spec.ts —— the screen assistant's cue card is made on the server (owner, 2026-10-20:
// the spec "StandMeet 服务端出卡" + "mcp接口也是，暴露出来，让facade可以agent自己接管"). Any driver —
// the desktop app, a mock-interview agent — asks assistant.cue and gets the card the owner's notes
// decide; assistant.context gives the same prompt to an agent that runs its own model.
//
// Criteria (each can go red):
//   · the card comes from the owner's model (DeepSeek runs the fast model, deepseek-flash) and
//     lands in the screen-assistant feed under feed_id — the page shows it;
//   · the role's scope is a ceiling: a note outside it never reaches the context;
//   · a question naming a technology turns the choice matrix on;
//   · one call keeps its conversation: the second question's request carries the first card;
//   · the Mentor round never sees someone else's facts; the General round sees them, marked;
//   · a wrong role, an empty scope, an empty question say so.

import type { Playwright } from '@playwright/test';

import { test, expect, type APIRequestContext, type Page } from '@/fixtures/test';

import {
  ANTHROPIC_MOCK_CFG, DEEPSEEK_MOCK_CFG, createAPIToken, login as loginAPI, seedAIProvider,
} from '@/fixtures/admin';
import { createProvider } from '@/fixtures/providers';
import { claimFreshOwner } from '@/fixtures/seed';
import { callTool, callToolOutcome, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { seedWiki } from '@/fixtures/corpus';
import { lastGatewayRequest, scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'assistant-cue@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'assistantcue',
  fullName: 'Assistant Cue Owner',
};
const ROLE = 'cue-software';
const EMPTY_ROLE = 'cue-nothing';
const CLAUDE_ROLE = 'cue-on-claude';

interface Prompt { system: string; sources: string[]; matrix: string; stack_named: string[] }
interface Cue { card: string; feed_id: string; model: string; debug: Prompt }
interface Tools {
  call: <T>(name: string, args: Record<string, unknown>) => Promise<T>;
  outcome: (name: string, args: Record<string, unknown>) => Promise<{ isError: boolean; text: string }>;
}

async function tools(request: APIRequestContext, name: string): Promise<Tools> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, name);
  const sid = await initMCP(request, token);
  return {
    call: <T>(tool: string, args: Record<string, unknown>) => callTool<T>(request, token, sid, tool, args),
    outcome: (tool: string, args: Record<string, unknown>) => callToolOutcome(request, token, sid, tool, args),
  };
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('assistant.cue', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    await seedOwner(playwright);
  });
  test('a question gets a card on the owner model, into the feed', cardIntoFeed);
  test('one call keeps its conversation', callKeepsConversation);
  test('the Mentor round never sees someone else’s facts', mentorSeesOwnWork);
  test('prepare: the note count and the names for speech recognition', prepareSession);
  test('a wrong ask says what is wrong', wrongAsks);
  test('a model that thinks first still writes the card', thinkingModelWrites);
  test('the rewrite restores a mis-heard name and refuses an invented one', rewriteGuarded);
});

interface Heard { heard: string; question: string; refused?: string }

// rewriteGuarded —— owner, 2026-10-21: "除了accent还有stutter，你光靠stt技术肯定不行，绝对是要有个重写层的".
// The rewrite turns what speech recognition heard into what was meant; code refuses a rewrite
// that brings in a name nothing heard sounds like (the first rewrite tried turned "Coopatavi"
// into Kubernetes).
async function rewriteGuarded({ request }: { request: APIRequestContext }): Promise<void> {
  const t = await tools(request, 'assistant-cue-rewrite');
  const fixTag = await scriptMockReplyText(request, '{"question":"How does bwrap isolate the plugins?"}');
  const fixed = await t.call<Prompt & { heard: Heard }>('assistant.context', {
    role_id: ROLE, rewrite: true, question: `How does uh how does BRAP isolate the the plugins?${fixTag}`,
  });
  expect(fixed.heard.question).toBe('How does bwrap isolate the plugins?');
  expect(fixed.stack_named, 'the restored name finds its notes').toEqual(['bubblewrap']);

  const inventTag = await scriptMockReplyText(request, '{"question":"How does Kubernetes isolate the plugins?"}');
  const refused = await t.call<Prompt & { heard: Heard }>('assistant.context', {
    role_id: ROLE, rewrite: true, question: `How does Coopatavi isolate the plugins?${inventTag}`,
  });
  expect(refused.heard.refused).toMatch(/kubernetes/i);
  expect(refused.heard.question, 'the line as heard is kept').toContain('Coopatavi');
  expect(refused.stack_named).toEqual([]);
}

// thinkingModelWrites —— prod 2026-10-20: the interview role runs on Claude 5.5 Haiku, which
// thinks by default; its thinking took the whole 800-token budget and every card came back
// "the model returned no text". The mock answers [[thinks-first]] the same way unless the
// request turns thinking off.
async function thinkingModelWrites({ request }: { request: APIRequestContext }): Promise<void> {
  const t = await tools(request, 'assistant-cue-thinking');
  const text = '**Key: orchestration + alternatives**\n**Not in your own work: you ruled Kubernetes out.**';
  const tag = await scriptMockReplyText(request, text);
  const cue = await t.call<Cue>('assistant.cue', {
    role_id: CLAUDE_ROLE, round: 'technical',
    question: `Tell me about your experience with Kubernetes.[[thinks-first]]${tag}`,
  });
  // the Anthropic mock echoes the whole system prompt ahead of the reply
  expect(cue.card.endsWith(text), cue.card.slice(-200)).toBe(true);
}

// seedOwner —— the owner on the mock DeepSeek, three notes (one inside the role's scope, one
// someone else's fact, one outside the scope) and two roles (one with an empty scope).
async function seedOwner(playwright: Playwright): Promise<void> {
  await claimFreshOwner(playwright, OWNER);
  const request = await playwright.request.newContext();
  await seedAIProvider(request, OWNER, DEEPSEEK_MOCK_CFG);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'assistant-cue-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    title: 'acme', path: 'software/project/acme',
    body: 'Acme runs its plugins in bubblewrap instead of Docker: the backend never holds docker.sock.',
  });
  const kafka = 'LinkedIn runs Kafka as the durable log between its services.';
  const { wikiID } = await seedWiki(request, token, sid, {
    title: 'kafka-at-linkedin', path: 'software/kafka-at-linkedin', body: kafka,
  });
  await callTool(request, token, sid, 'corpus.update', {
    genre: 'wiki', id: wikiID, title: 'kafka-at-linkedin', body: kafka, tags: ['fact'],
  });
  await seedWiki(request, token, sid, {
    title: 'risotto', path: 'cooking/risotto', body: 'Stir the rice slowly; plugins of parmesan.',
  });
  await createRole(request, csrf, {
    name: ROLE, description: 'Platform engineer interview', corpus_uris: ['wiki://software/**'],
  });
  await createRole(request, csrf, { name: EMPTY_ROLE, corpus_uris: ['wiki://nothing/**'] });
  const claude = await createProvider(request, csrf, { label: 'claude', ...ANTHROPIC_MOCK_CFG });
  await createRole(request, csrf, {
    name: CLAUDE_ROLE, corpus_uris: ['wiki://software/**'], provider_id: claude.id,
  });
  await request.dispose();
}

async function cardIntoFeed(
  { request, adminPage }: { request: APIRequestContext; adminPage: Page },
): Promise<void> {
  const t = await tools(request, 'assistant-cue-card');
  const text = '**Key: isolation + no docker.sock**\n**Plugins run in bubblewrap, so the backend never holds docker.sock.**';
  const tag = await scriptMockReplyText(request, text);
  await gotoAdminSection(adminPage, 'screen-assistant');

  const cue = await t.call<Cue>('assistant.cue', {
    role_id: ROLE, question: `Why bubblewrap for the plugins and not Docker?${tag}`, debug: true,
  });
  expect(cue.card).toBe(text);
  expect(cue.model).toBe('deepseek-flash');
  expect((await lastGatewayRequest(request, tag)).model, 'DeepSeek runs the fast model').toBe('deepseek-flash');
  expect(cue.debug.matrix).toBe('on');
  expect(cue.debug.stack_named).toEqual(['bubblewrap', 'Docker']);
  expect(cue.debug.sources).toContain('software/project/acme');
  expect(cue.debug.sources, 'the scope is a ceiling').not.toContain('cooking/risotto');
  expect(cue.debug.system).toContain('# This interview\ncue-software — Platform engineer interview');
  expect(cue.debug.system).not.toContain('Stir the rice');

  const { events } = await t.call<{ events: { id: string; kind: string; text: string }[] }>(
    'assistant.read', { since: 0 });
  expect(events.find((e) => e.id === cue.feed_id), 'the card is in the feed').toMatchObject({ kind: 'cue', text });
  await expect(adminPage.getByTestId('assistant-cue').filter({ hasText: 'Plugins run in bubblewrap' }))
    .toBeVisible({ timeout: 10_000 });
}

async function callKeepsConversation({ request }: { request: APIRequestContext }): Promise<void> {
  const t = await tools(request, 'assistant-cue-call');
  const first = await scriptMockReplyText(request, 'FIRST-CARD-7731 about sandboxes');
  await t.call<Cue>('assistant.cue', { role_id: ROLE, call_id: 'call-1', question: `How do you sandbox plugins?${first}` });
  const second = await scriptMockReplyText(request, 'second card');
  await t.call<Cue>('assistant.cue', { role_id: ROLE, call_id: 'call-1', question: `And why not Docker?${second}` });
  expect((await lastGatewayRequest(request, second, 'FIRST-CARD-7731')).contains,
    'the second question sees the first card').toBe(true);
}

async function mentorSeesOwnWork({ request }: { request: APIRequestContext }): Promise<void> {
  const t = await tools(request, 'assistant-cue-rounds');
  const q = { role_id: ROLE, question: 'Have you run Kafka in production?' };
  const general = await t.call<Prompt>('assistant.context', { ...q, round: 'general' });
  expect(general.system).toContain("## kafka-at-linkedin (software/kafka-at-linkedin) — someone else's");
  const mentor = await t.call<Prompt>('assistant.context', { ...q, round: 'mentor' });
  expect(mentor.sources).not.toContain('software/kafka-at-linkedin');
  expect(mentor.system).toContain('**THIS ROUND: Mentor**');
}

async function prepareSession({ request }: { request: APIRequestContext }): Promise<void> {
  const t = await tools(request, 'assistant-cue-prepare');
  const p = await t.call<{ notes: number; hint: string; rounds: { id: string }[] }>(
    'assistant.prepare', { role_id: ROLE });
  // acme, kafka-at-linkedin and the parent node seedWiki made for them (software/project);
  // risotto is outside the scope, and so is "software" itself (wiki://software/** needs a slash)
  expect(p.notes).toBe(3);
  expect(p.hint).toContain('acme');
  expect(p.hint).toContain('bwrap');
  expect(p.rounds.map((r) => r.id)).toContain('mentor');
}

async function wrongAsks({ request }: { request: APIRequestContext }): Promise<void> {
  const t = await tools(request, 'assistant-cue-errors');
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ role_id: 'no-such-role', question: 'Hi?' }, /no such role/],
    [{ role_id: EMPTY_ROLE, question: 'Hi?' }, /holds no notes/],
    [{ role_id: ROLE, question: '  ' }, /question is required/],
    [{ role_id: ROLE, question: 'Hi?', round: 'poker' }, /no such round/],
  ];
  for (const [args, says] of cases) {
    const out = await t.outcome('assistant.cue', args);
    expect(out.isError, JSON.stringify(args)).toBe(true);
    expect(out.text).toMatch(says);
  }
}
