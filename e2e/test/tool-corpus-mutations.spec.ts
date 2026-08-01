// tool-corpus-mutations.spec.ts —— owner 经 MCP 摆弄语料的**genre 矩阵**。
//
// 业务故事:owner 在 Claude Code 跟自己的 AI 说"把这条 wiki 改个标题"、"把这条 raw 提上去"、
// "建一条 output",AI 调 corpus.* → 收口 → 域。面板重新打开看到同样的结果。
//
// genre 是**参数**,不是三套工具。归一化前两个面覆盖不一样:面板能建 wiki / output、能改 raw,
// MCP 只有 raw_dump / update_wiki / update_output / delete_wiki / delete_output / promote_*。
// 也就是说 owner 从 Claude Code **建不了一条 wiki、改不了一条 raw**。下面标 "补上的格子"
// 那四条就是原来缺的——它们此前一条覆盖都没有。

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'corpus-mut@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpus-mut', fullName: 'Corpus Mutations Owner',
};

// 一条语料在每个面上的那一份形状(不适用的字段是零值)。
interface CorpusItem {
  id: string;
  genre: string;
  title: string;
  body?: string;
  preview: string;
  status?: string;
  tags: string[];
  source_raw_ids: string[];
  source_wiki_ids: string[];
  published: boolean;
}
interface DeleteResp { id: string; genre: string; deleted: boolean }

let sid: string;
let apiToken: string;
let wikiID: string;
let outputID: string;

async function seedCorpusMut(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  apiToken = await createAPIToken(request, csrf, 'corpus-mut-token');
  sid = await initMCP(request, apiToken);

  const raw = await createEntry(request, { genre: 'raw', body: 'seed raw body', tags: ['e3'] });
  const wiki = await promote(request, { genre: 'raw', id: raw.id, title: 'Seed wiki' });
  wikiID = wiki.id;
  const output = await promote(request, { genre: 'wiki', id: wikiID, title: 'Seed output' });
  outputID = output.id;
  await request.dispose();
}

// ── 小 helper:一个动词一个 ────────────────────────────────────────────

function createEntry(
  request: APIRequestContext, args: Record<string, unknown>,
): Promise<CorpusItem> {
  return callTool<CorpusItem>(request, apiToken, sid, 'corpus.create', args);
}

function promote(
  request: APIRequestContext, args: Record<string, unknown>,
): Promise<CorpusItem> {
  return callTool<CorpusItem>(request, apiToken, sid, 'corpus.promote', args);
}

function updateEntry(
  request: APIRequestContext, args: Record<string, unknown>,
): Promise<CorpusItem> {
  return callTool<CorpusItem>(request, apiToken, sid, 'corpus.update', args);
}

function listGenre(request: APIRequestContext, genre: string): Promise<CorpusItem[]> {
  return callTool<CorpusItem[]>(request, apiToken, sid, 'corpus.list', { genre });
}

async function titleInList(
  request: APIRequestContext, genre: string, id: string,
): Promise<string | undefined> {
  const list = await listGenre(request, genre);
  return list.find((it) => it.id === id)?.title;
}

// ── 原有的四条:改 / 删 wiki 和 output ─────────────────────────────────

async function testUpdateWiki(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const resp = await updateEntry(request, {
    genre: 'wiki', id: wikiID, title: 'Renamed wiki',
    body: 'New body content', tags: ['e3', 'renamed'],
  });
  expect(resp.id).toBe(wikiID);
  expect(resp.title).toBe('Renamed wiki');
  expect(await titleInList(request, 'wiki', wikiID)).toBe('Renamed wiki');
  await request.dispose();
}

async function testUpdateOutput(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const resp = await updateEntry(request, {
    genre: 'output', id: outputID, title: 'Renamed output',
    body: 'Polished new body', tags: ['e3', 'renamed'],
  });
  expect(resp.id).toBe(outputID);
  expect(resp.title).toBe('Renamed output');
  expect(await titleInList(request, 'output', outputID)).toBe('Renamed output');
  await request.dispose();
}

async function testDeleteWiki(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const raw = await createEntry(request, { genre: 'raw', body: 'will-be-deleted raw' });
  const doomed = await promote(request, { genre: 'raw', id: raw.id, title: 'Wiki to delete' });

  const resp = await callTool<DeleteResp>(
    request, apiToken, sid, 'corpus.delete', { genre: 'wiki', id: doomed.id },
  );
  expect(resp.deleted).toBe(true);
  expect(resp.id).toBe(doomed.id);
  expect(await titleInList(request, 'wiki', doomed.id)).toBeUndefined();
  await request.dispose();
}

async function testDeleteOutput(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const raw = await createEntry(request, { genre: 'raw', body: 'output-to-delete seed' });
  const wiki = await promote(request, {
    genre: 'raw', id: raw.id, title: 'Wiki for output to delete',
  });
  const doomed = await promote(request, {
    genre: 'wiki', id: wiki.id, title: 'Output to delete',
  });

  const resp = await callTool<DeleteResp>(
    request, apiToken, sid, 'corpus.delete', { genre: 'output', id: doomed.id },
  );
  expect(resp.deleted).toBe(true);
  expect(await titleInList(request, 'output', doomed.id)).toBeUndefined();
  await request.dispose();
}

// ── 补上的格子:归一化前 MCP 根本没有的四件 ───────────────────────────

async function testCreateWikiDirectly(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const wiki = await createEntry(request, {
    genre: 'wiki', title: 'Written straight to wiki',
    body: 'no raw step', tags: ['direct'],
  });
  expect(wiki.genre).toBe('wiki');
  expect(wiki.id).toMatch(/^[0-9a-f-]{36}$/);
  // 直接建的 wiki 没有来源 raw —— 那正是"不经 raw 这一步"的证据。
  expect(wiki.source_raw_ids).toEqual([]);
  expect(await titleInList(request, 'wiki', wiki.id)).toBe('Written straight to wiki');
  await request.dispose();
}

async function testCreateOutputDirectly(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const out = await createEntry(request, {
    genre: 'output', title: 'Written straight to output', body: 'shipped as-is',
  });
  expect(out.genre).toBe('output');
  expect(out.source_wiki_ids).toEqual([]);
  expect(await titleInList(request, 'output', out.id)).toBe('Written straight to output');
  await request.dispose();
}

async function testUpdateRaw(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const raw = await createEntry(request, { genre: 'raw', body: 'first thought' });
  const edited = await updateEntry(request, {
    genre: 'raw', id: raw.id, body: 'second thought', tags: ['edited'],
  });
  expect(edited.id).toBe(raw.id);
  expect(edited.body).toBe('second thought');

  const list = await listGenre(request, 'raw');
  expect(list.find((it) => it.id === raw.id)?.body).toBe('second thought');
  await request.dispose();
}

async function testArchiveRaw(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const raw = await createEntry(request, { genre: 'raw', body: 'to be archived' });

  const resp = await callTool<DeleteResp>(
    request, apiToken, sid, 'corpus.delete', { genre: 'raw', id: raw.id },
  );
  expect(resp.deleted).toBe(true);
  // raw 是**归档**不是硬删,但归档后不再出现在列表里(它已经不是待收拾的东西了)。
  const list = await listGenre(request, 'raw');
  expect(list.find((it) => it.id === raw.id)).toBeUndefined();
  await request.dispose();
}

// ── genre 本身的校验 ─────────────────────────────────────────────────

async function testUnknownGenre(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  await expect(
    callTool(request, apiToken, sid, 'corpus.list', { genre: 'nonsense' }),
  ).rejects.toThrow(/raw.*wiki.*output/);
  await request.dispose();
}

test.describe('corpus mutations via MCP · genre 矩阵', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedCorpusMut(playwright);
  });

  test('corpus.update on wiki changes title + body; the list reflects it',
    async ({ playwright }) => { await testUpdateWiki(playwright); });

  test('corpus.update on output changes title + body; the list reflects it',
    async ({ playwright }) => { await testUpdateOutput(playwright); });

  test('corpus.delete removes a wiki; the list no longer shows it',
    async ({ playwright }) => { await testDeleteWiki(playwright); });

  test('corpus.delete removes an output; the list no longer shows it',
    async ({ playwright }) => { await testDeleteOutput(playwright); });

  test('补上的格子:corpus.create writes a wiki directly, with no raw step',
    async ({ playwright }) => { await testCreateWikiDirectly(playwright); });

  test('补上的格子:corpus.create writes an output directly',
    async ({ playwright }) => { await testCreateOutputDirectly(playwright); });

  test('补上的格子:corpus.update edits a raw entry in place',
    async ({ playwright }) => { await testUpdateRaw(playwright); });

  test('补上的格子:corpus.delete archives a raw entry',
    async ({ playwright }) => { await testArchiveRaw(playwright); });

  test('an unknown genre is refused, naming the three that exist',
    async ({ playwright }) => { await testUnknownGenre(playwright); });
});
