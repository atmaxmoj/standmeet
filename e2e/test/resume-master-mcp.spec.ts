// resume-master-mcp.spec.ts —— the owner's AI drives masters through MCP the way the panel does
// (one usecase behind both faces): master_create → master_list (paged envelope) → resume.draft with
// master_id → the draft's content equals the master's and names it; draft_save_as_master
// round-trips (new master, then overwrite); master_update / master_get / master_delete.
// docs/design/resume-masters.md, test 8.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeUpdateDraft } from '@/fixtures/resume';
import {
  contentWith, mcpDraftFromMaster, mcpMasterCreate, mcpMasterDelete, mcpMasterGet, mcpMasterList,
  mcpMasterUpdate, mcpSaveAsMaster,
} from '@/fixtures/resume-masters';

const OWNER = {
  email: 'master-mcp@example.com', password: 'correct-horse-battery-staple',
  handle: 'mastermcp', fullName: 'Master MCP Owner',
};

test.describe('résumé masters · MCP', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('create → list (paged) → draft from master → save_as_master round-trips', async ({ request }) => {
    test.setTimeout(120_000);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'resume-master-mcp');
    const sid = await initMCP(request, token);
    const c = { request, token, sid };

    const general = await mcpMasterCreate(c, { name: 'General', resume_content: contentWith('MCPGENERAL'), is_default: true });
    const java = await mcpMasterCreate(c, { name: 'Java backend', resume_content: contentWith('MCPJAVA') });
    expect(general.is_default).toBe(true);
    expect(java.is_default).toBe(false);

    // master_list pages with the one envelope: newest first, limit 1 → a next_cursor, total 2.
    const p1 = await mcpMasterList(c, { limit: 1 });
    expect(p1.total).toBe(2);
    expect(p1.items.map((m) => m.name)).toEqual(['Java backend']);
    expect(p1.next_cursor, 'a second page exists').toBeTruthy();
    const p2 = await mcpMasterList(c, { limit: 1, cursor: p1.next_cursor });
    expect(p2.items.map((m) => m.name)).toEqual(['General']);
    expect(p2.next_cursor, 'the last page has no cursor').toBeFalsy();

    // resume.draft with master_id (no resume_content): the draft starts as the master's content.
    const source = await jobsRegisterSource(request, token, sid, {
      kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
    });
    const job = (await jobsFetchNew(request, token, sid, source.id)).jobs[0]!;
    const drafted = await mcpDraftFromMaster(c, job.cache_id, java.id);
    expect(drafted.based_on_master_id).toBe(java.id);
    expect(drafted.resume_content?.summary).toBe('MCPJAVA');

    // The AI tailors the draft, then keeps it as a new master …
    await resumeUpdateDraft(request, token, sid, drafted.draft_id, contentWith('MCPTAILORED'));
    const saved = await mcpSaveAsMaster(c, { draft_id: drafted.draft_id, name: 'Airbnb cut', make_default: true });
    expect(saved.name).toBe('Airbnb cut');
    expect(saved.resume_content.summary).toBe('MCPTAILORED');
    expect(saved.is_default).toBe(true);
    expect((await mcpMasterGet(c, general.id)).is_default, 'only one default').toBe(false);

    // … and overwrites the master the draft came from.
    await mcpSaveAsMaster(c, { draft_id: drafted.draft_id, master_id: java.id });
    expect((await mcpMasterGet(c, java.id)).resume_content.summary).toBe('MCPTAILORED');
    expect((await mcpMasterList(c)).total).toBe(3);

    // master_update renames; master_delete removes.
    const renamed = await mcpMasterUpdate(c, { master_id: java.id, name: 'Java / JVM' });
    expect(renamed.name).toBe('Java / JVM');
    expect((await mcpMasterDelete(c, java.id)).ok).toBe(true);
    const after = await mcpMasterList(c);
    expect(after.total).toBe(2);
    expect(after.items.map((m) => m.name).sort()).toEqual(['Airbnb cut', 'General']);
  });
});
