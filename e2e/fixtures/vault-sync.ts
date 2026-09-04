// vault-sync.ts —— shared setup + helpers for the sync-face specs (sync-a..j).
// Each spec only uploads a small vault + asserts corpus state; setup / read / admin reads all live here, keeping the 10 files thin.
//
// Target state (currently all red: the importer still flattens every .md into writings, not routing by folder→genre / node tree).

import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

export const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface SyncOwner {
  email: string;
  password: string;
  handle: string;
  fullName: string;
}

// syncOwner —— each spec is isolated by a different handle/email, sharing one vault-all role (granting all genres).
export function syncOwner(letter: string): SyncOwner {
  return {
    email: `sync${letter}@example.com`,
    password: 'correct-horse-battery-staple',
    handle: `sync${letter}`,
    fullName: `Sync ${letter.toUpperCase()} Owner`,
  };
}

const CODE = 'SYNC-ALL';

const ALL_GENRE_GLOBS = ['wiki://**', 'output://**', 'writing://**', 'subjectivity://**'];

// claimSyncOwner —— resetInstance + claim + a genre-granting role + code. Omitting globs = grant all genres.
export async function claimSyncOwner(
  request: APIRequestContext, owner: SyncOwner, globs: string[] = ALL_GENRE_GLOBS,
): Promise<void> {
  resetInstance();
  await claim(request, findSetupToken(), {
    email: owner.email, password: owner.password,
    handle: owner.handle, fullName: owner.fullName,
  });
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  await createAPIToken(request, csrf, `sync-${owner.handle}`);
  const role = await createRole(request, csrf, {
    name: 'vault-role', description: 'granted genres', corpus_uris: globs,
  });
  await createCode(request, csrf, { code: CODE, label: 's', assumed_role_id: role.id });
}

export async function syncSession(
  request: APIRequestContext, owner: SyncOwner,
): Promise<VisitorSession> {
  return issueSession(request, { handle: owner.handle, code: CODE, visitor_name: 'V' });
}

export interface ReadResult {
  body?: string;
  genre?: string;
  title?: string;
  error?: string;
  css_classes?: string[]; // cssclasses frontmatter (per-note presentation hook)
}

// syncRead —— visitor corpus_read (all genres granted), fetch one note by path.
export async function syncRead(
  request: APIRequestContext, sess: VisitorSession, path: string,
): Promise<ReadResult> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/corpus_read`,
    { headers: { Authorization: `Bearer ${sess.session_token}` }, data: { path } },
  );
  const body = await res.json() as { result?: ReadResult };
  return body.result ?? {};
}

export interface AdminNote {
  id: string;
  title?: string;
  body?: string;
  path?: string | null;
  parent_id?: string | null;
  // published —— the ANONYMOUS-visibility gate (was seo_indexed), NOT corpus membership:
  // "anonymous sees published only, with a code goes by the role corpus_uris glob" (wiki_tree.go). See sync-d-publish.
  published?: boolean;
  outbound?: Array<{ title: string }>;
  backlinks?: Array<{ title: string }>;
}

// adminGenreList —— owner admin lists all notes of a genre (id/title/body).
export async function adminGenreList(
  request: APIRequestContext, owner: SyncOwner, genre: string,
): Promise<AdminNote[]> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get(`${BACKEND}/api/admin/corpus/${genre}`, { headers: { 'X-Csrftoken': csrf } });
  return await res.json() as AdminNote[];
}

// adminNoteRefs —— owner admin's outbound/backlinks title list for one note.
export async function adminNoteRefs(
  request: APIRequestContext, owner: SyncOwner, genre: string, title: string,
): Promise<{ outbound: string[]; backlinks: string[] }> {
  const list = await adminGenreList(request, owner, genre);
  const hit = list.find((n) => n.title === title);
  if (!hit) return { outbound: [], backlinks: [] };
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get(`${BACKEND}/api/admin/corpus/${genre}/${hit.id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  const det = await res.json() as AdminNote;
  return {
    outbound: (det.outbound ?? []).map((r) => r.title),
    backlinks: (det.backlinks ?? []).map((r) => r.title),
  };
}
