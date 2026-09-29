// resume-masters.ts —— helpers for the résumé-master specs (docs/design/resume-masters.md).
//
// A master is a named, persistent résumé (resume_content only; no job, no code, no expiry). These
// helpers SEED state through the owner admin API (the same REST face the drafts page reads) and
// wrap the MCP resume.master_* tools. The action under test in each spec is driven through the UI or
// the MCP tool itself, never through a helper that hides it.

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { callTool, callToolMulti } from '@/fixtures/mcp';
import type { ResumeContent } from '@/fixtures/resume';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface MasterView {
  id: string;
  name: string;
  is_default: boolean;
  from_company: string;
  created_at: string;
  updated_at: string;
  resume_content: ResumeContent & { cover_letter?: string };
}

interface Paged<T> { items: T[]; next_cursor?: string; total?: number }

// contentWith —— a small, recognisable résumé: the summary names the master, so a card, a thumbnail
// or an opened editor shows which master it came from.
export function contentWith(summary: string, coverLetter = ''): ResumeContent & { cover_letter: string } {
  return {
    identity: { name: 'Mara Quill', email: 'mara@example.com', phone: '', location_line: 'Toronto, ON', site: '' },
    summary,
    cover_letter: coverLetter,
    works: [{
      title: 'Backend Engineer', company: 'Northwind', location: 'Remote',
      period: { start: '2021-03', end: '' }, bullets: ['Owned the dispatch pipeline.'],
    }],
    educations: [],
    skills: [{ category: 'Languages', items: ['Go', 'TypeScript'] }],
  };
}

async function send(
  api: APIRequestContext, method: 'post' | 'patch' | 'delete', path: string, csrf: string, data?: unknown,
): Promise<unknown> {
  const opts: { headers: Record<string, string>; data?: unknown } = { headers: { 'X-Csrftoken': csrf } };
  if (data !== undefined) opts.data = data;
  const r = await api[method](`${BACKEND}${path}`, opts);
  if (r.status() >= 300) throw new Error(`admin ${method.toUpperCase()} ${path} failed: ${r.status()} ${await r.text()}`);
  return r.status() === 204 ? null : r.json();
}

// ── seeding through the admin REST face ─────────────────────────────────────────────────────────

export async function seedMaster(
  api: APIRequestContext, csrf: string,
  data: { name: string; resume_content?: ResumeContent; draft_id?: string; is_default?: boolean },
): Promise<MasterView> {
  return await send(api, 'post', '/api/admin/masters', csrf, data) as MasterView;
}

// seedDraft —— a manual draft (company + role), optionally from a master; `blank` asks for an empty
// résumé even when a default master exists.
export async function seedDraft(
  api: APIRequestContext, csrf: string,
  data: { company: string; role?: string; master_id?: string; blank?: boolean },
): Promise<{ id: string }> {
  return await send(api, 'post', '/api/admin/drafts', csrf, data) as { id: string };
}

export async function seedDraftContent(
  api: APIRequestContext, csrf: string, id: string, content: ResumeContent,
): Promise<void> {
  await send(api, 'patch', `/api/admin/drafts/${id}`, csrf, { resume_content: content, template: '' });
}

// ── reads (what the drafts page reads) ──────────────────────────────────────────────────────────

export async function getMaster(api: APIRequestContext, id: string): Promise<MasterView> {
  const r = await api.get(`${BACKEND}/api/admin/masters/${id}`);
  expect(r.status(), `GET master ${id}`).toBe(200);
  return await r.json() as MasterView;
}

export async function listMasters(api: APIRequestContext, limit = 200): Promise<Paged<MasterView>> {
  const r = await api.get(`${BACKEND}/api/admin/masters?limit=${limit}`);
  expect(r.status(), 'GET masters').toBe(200);
  return await r.json() as Paged<MasterView>;
}

export async function getDraftContent(api: APIRequestContext, id: string): Promise<ResumeContent & { cover_letter?: string }> {
  const r = await api.get(`${BACKEND}/api/admin/drafts/${id}`);
  expect(r.status(), `GET draft ${id}`).toBe(200);
  return (await r.json() as { resume_content: ResumeContent & { cover_letter?: string } }).resume_content;
}

// ── UI drives ───────────────────────────────────────────────────────────────────────────────────

// openDrafts —— the drafts page through the sidebar, the way the owner gets there.
export async function openDrafts(page: Page): Promise<void> {
  await page.getByTestId('admin-nav-drafts').click();
  await page.waitForURL('**/admin/drafts', { timeout: 10_000 });
  await expect(page.getByTestId('masters-strip')).toBeVisible({ timeout: 15_000 });
}

// openComposerFor —— drafts page → the draft's "open composer" → the full-page editor.
export async function openComposerFor(page: Page, draftID: string): Promise<void> {
  await openDrafts(page);
  const open = page.getByTestId(`draft-open-${draftID}`);
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
}

// editCoverLetter —— the Cover letter is a Puck root field: always in the panel, no canvas selection.
export async function editCoverLetter(page: Page, text: string): Promise<void> {
  const cover = page.getByLabel('Cover letter');
  await expect(cover, 'the Cover letter field is shown').toBeVisible({ timeout: 15_000 });
  await cover.fill(text);
}

// saveAsMaster —— the composer's "set as master ▾" popover: overwrite the master the draft came from,
// or save as a new master (a name, optionally the default).
export async function saveAsMaster(
  page: Page, opts: { overwrite: true } | { name: string; makeDefault?: boolean },
): Promise<void> {
  await page.getByTestId('composer-save-as-master').click();
  const pop = page.getByTestId('save-as-master-popover');
  await expect(pop).toBeVisible();
  if ('overwrite' in opts) {
    await pop.getByTestId('save-master-overwrite').check();
  } else {
    await pop.getByTestId('save-master-new').check();
    await pop.getByTestId('save-master-name').fill(opts.name);
    if (opts.makeDefault) await pop.getByTestId('save-master-default').check();
  }
  await pop.getByTestId('save-master-confirm').click();
  await expect(pop).toBeHidden({ timeout: 15_000 });
}

// masterCard —— one card in the masters strip, found by the name it shows.
export function masterCard(page: Page, name: string) {
  return page.getByTestId('master-card').filter({ has: page.getByTestId('master-name').getByText(name, { exact: true }) });
}

// ── MCP resume.master_* ─────────────────────────────────────────────────────────────────────────

type Ctx = { request: APIRequestContext; token: string; sid: string };

export const mcpMasterCreate = (c: Ctx, args: Record<string, unknown>) =>
  callTool<MasterView>(c.request, c.token, c.sid, 'resume.master_create', args);
export const mcpMasterList = (c: Ctx, args: Record<string, unknown> = {}) =>
  callTool<Paged<MasterView>>(c.request, c.token, c.sid, 'resume.master_list', args);
export const mcpMasterGet = (c: Ctx, id: string) =>
  callTool<MasterView>(c.request, c.token, c.sid, 'resume.master_get', { master_id: id });
export const mcpMasterUpdate = (c: Ctx, args: Record<string, unknown>) =>
  callTool<MasterView>(c.request, c.token, c.sid, 'resume.master_update', args);
export const mcpMasterDelete = (c: Ctx, id: string) =>
  callTool<{ ok: boolean }>(c.request, c.token, c.sid, 'resume.master_delete', { master_id: id });
export const mcpSaveAsMaster = (c: Ctx, args: Record<string, unknown>) =>
  callTool<MasterView>(c.request, c.token, c.sid, 'resume.draft_save_as_master', args);

// mcpDraftFromMaster —— resume.draft with a master_id and no resume_content: the draft starts from the
// master. Returns the draft view (it carries resume_content and based_on_master_id).
export async function mcpDraftFromMaster(
  c: Ctx, jobCacheID: string, masterID: string,
): Promise<{ draft_id: string; based_on_master_id?: string; resume_content?: ResumeContent }> {
  const parts = await callToolMulti(c.request, c.token, c.sid, 'resume.draft', {
    job_cache_id: jobCacheID, master_id: masterID,
  });
  const text = parts.find((p) => p.type === 'text');
  if (!text || text.type !== 'text') throw new Error('resume.draft: missing text content');
  return JSON.parse(text.text) as { draft_id: string; based_on_master_id?: string; resume_content?: ResumeContent };
}
