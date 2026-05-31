// tool-corpus-mutations.spec.ts —— Phase E-3 MCP parity:
// owner-side corpus mutation tools (update_wiki / update_output / delete_wiki /
// delete_output) callable via MCP.
//
// 业务故事:
//   owner 在 Claude Code 跟 AI 聊 "把 wiki <id> 标题改成 ...";
//   AI 调 update_wiki({...}) → MCP adapter → usecases.UpdateWiki → DB。
//   admin UI 重新打开能看到新 title。delete_* 同理 (gone from list)。
//
// 老路径只暴露 raw_dump / promote_to_wiki / list_recent_wiki / promote_wiki_to_output。
// 改 / 删 都得回 admin UI 手动点，AI 无 affordance。本 spec 补 4 tool 后
// AI 即可在 Claude Code 全程 curate corpus。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'corpus-mut@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpus-mut', fullName: 'Corpus Mutations Owner',
};

interface RawDumpResp { raw_id: string }
interface PromoteWikiResp { wiki_id: string }
interface PromoteOutputResp { output_id: string }
interface UpdateResp { id: string; title: string; body: string }
interface DeleteResp { id: string; deleted: boolean }
interface WikiListItem { id: string; title: string }
interface OutputListItem { id: string; title: string }

test.describe('Phase E-3 corpus mutations via MCP', () => {
  let sid: string;
  let apiToken: string;
  let wikiID: string;
  let outputID: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    apiToken = await createAPIToken(request, csrf, 'corpus-mut-token');
    sid = await initMCP(request, apiToken);

    // seed: raw → wiki → output
    const rawResp = await callTool<RawDumpResp>(
      request, apiToken, sid, 'raw_dump',
      { body: 'seed raw body', source: 'spec', tags: ['e3'] },
    );
    const wikiResp = await callTool<PromoteWikiResp>(
      request, apiToken, sid, 'promote_to_wiki',
      { raw_id: rawResp.raw_id, title: 'Seed wiki' },
    );
    wikiID = wikiResp.wiki_id;
    const outputResp = await callTool<PromoteWikiResp & PromoteOutputResp>(
      request, apiToken, sid, 'promote_wiki_to_output',
      { wiki_id: wikiID, title: 'Seed output' },
    );
    outputID = outputResp.output_id;
    await request.dispose();
  });

  test('update_wiki changes title + body; admin list reflects',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const resp = await callTool<UpdateResp>(
        request, apiToken, sid, 'update_wiki',
        {
          wiki_id: wikiID,
          title: 'Renamed wiki',
          body: 'New body content',
          tags: ['e3', 'renamed'],
        },
      );
      expect(resp.id).toBe(wikiID);
      expect(resp.title).toBe('Renamed wiki');
      expect(resp.body).toBe('New body content');

      const list = await callTool<WikiListItem[]>(
        request, apiToken, sid, 'list_recent_wiki', {},
      );
      const found = list.find((w) => w.id === wikiID);
      expect(found?.title).toBe('Renamed wiki');
      await request.dispose();
    });

  test('update_output changes title + body; admin list reflects',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const resp = await callTool<UpdateResp>(
        request, apiToken, sid, 'update_output',
        {
          output_id: outputID,
          title: 'Renamed output',
          body: 'Polished new body',
          tags: ['e3', 'renamed'],
        },
      );
      expect(resp.id).toBe(outputID);
      expect(resp.title).toBe('Renamed output');
      expect(resp.body).toBe('Polished new body');

      const list = await callTool<OutputListItem[]>(
        request, apiToken, sid, 'list_recent_output', {},
      );
      const found = list.find((o) => o.id === outputID);
      expect(found?.title).toBe('Renamed output');
      await request.dispose();
    });

  test('delete_wiki removes entry; admin list no longer shows it',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // seed another wiki to delete (the main one is needed for output test)
      const rawResp = await callTool<RawDumpResp>(
        request, apiToken, sid, 'raw_dump',
        { body: 'will-be-deleted raw', source: 'spec' },
      );
      const wikiToDelete = await callTool<PromoteWikiResp>(
        request, apiToken, sid, 'promote_to_wiki',
        { raw_id: rawResp.raw_id, title: 'Wiki to delete' },
      );

      const resp = await callTool<DeleteResp>(
        request, apiToken, sid, 'delete_wiki',
        { wiki_id: wikiToDelete.wiki_id },
      );
      expect(resp.deleted).toBe(true);
      expect(resp.id).toBe(wikiToDelete.wiki_id);

      const list = await callTool<WikiListItem[]>(
        request, apiToken, sid, 'list_recent_wiki', {},
      );
      const found = list.find((w) => w.id === wikiToDelete.wiki_id);
      expect(found).toBeUndefined();
      await request.dispose();
    });

  test('delete_output removes entry; admin list no longer shows it',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // seed another output to delete (independent of update test row)
      const rawResp = await callTool<RawDumpResp>(
        request, apiToken, sid, 'raw_dump',
        { body: 'will-be-deleted output seed raw', source: 'spec' },
      );
      const wikiResp = await callTool<PromoteWikiResp>(
        request, apiToken, sid, 'promote_to_wiki',
        { raw_id: rawResp.raw_id, title: 'Wiki for output to delete' },
      );
      const outputToDelete = await callTool<PromoteOutputResp>(
        request, apiToken, sid, 'promote_wiki_to_output',
        { wiki_id: wikiResp.wiki_id, title: 'Output to delete' },
      );

      const resp = await callTool<DeleteResp>(
        request, apiToken, sid, 'delete_output',
        { output_id: outputToDelete.output_id },
      );
      expect(resp.deleted).toBe(true);
      expect(resp.id).toBe(outputToDelete.output_id);

      const list = await callTool<OutputListItem[]>(
        request, apiToken, sid, 'list_recent_output', {},
      );
      const found = list.find((o) => o.id === outputToDelete.output_id);
      expect(found).toBeUndefined();
      await request.dispose();
    });
});

// Ensure BACKEND import is used (lint hates dangling vars).
void BACKEND;
