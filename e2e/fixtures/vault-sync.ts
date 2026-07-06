// vault-sync.ts —— sync-face specs (sync-a..j) 的共享 setup + helpers。
// 每个 spec 只管 upload 一个小 vault + 断言 corpus 状态;setup / read / admin 读全在这里,10 个文件保持薄。
//
// 目标态(现在全红:importer 还是把所有 .md 拍平进 writings,不按 folder→genre / 节点树路由)。

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

// syncOwner —— 每个 spec 用不同 handle/email 隔离,同一套 vault-all role(授全 genre)。
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

// claimSyncOwner —— resetInstance + claim + 一个授 genre 的 role + code。globs 省略 = 授全 genre。
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

// syncRead —— 访客 corpus_read(授全 genre),按 path 拿一条 note。
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
  outbound?: Array<{ title: string }>;
  backlinks?: Array<{ title: string }>;
}

// adminGenreList —— owner admin 列某 genre 的所有 note(id/title/body)。
export async function adminGenreList(
  request: APIRequestContext, owner: SyncOwner, genre: string,
): Promise<AdminNote[]> {
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get(`${BACKEND}/api/admin/${genre}`, { headers: { 'X-Csrftoken': csrf } });
  return await res.json() as AdminNote[];
}

// adminNoteRefs —— owner admin 一条 note 的 outbound/backlinks title 列表。
export async function adminNoteRefs(
  request: APIRequestContext, owner: SyncOwner, genre: string, title: string,
): Promise<{ outbound: string[]; backlinks: string[] }> {
  const list = await adminGenreList(request, owner, genre);
  const hit = list.find((n) => n.title === title);
  if (!hit) return { outbound: [], backlinks: [] };
  const { csrf } = await loginAPI(request, owner.email, owner.password);
  const res = await request.get(`${BACKEND}/api/admin/${genre}/${hit.id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  const det = await res.json() as AdminNote;
  return {
    outbound: (det.outbound ?? []).map((r) => r.title),
    backlinks: (det.backlinks ?? []).map((r) => r.title),
  };
}
