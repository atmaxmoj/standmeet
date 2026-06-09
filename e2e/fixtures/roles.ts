// roles.ts —— admin POST /api/admin/roles 创建 role 的 helper。
//
// 测试 ACL 时：先建一个 role 写 corpus_uris (positive-list URI glob)，再发码
// 引用这个 role；session 起 freeze 后 retriever 用 RoleSnapshot.AllowsCorpus
// 评估 wiki/output/writing。

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface CreateRoleInput {
  name: string;
  description?: string;
  greeting?: string;
  prompt_id?: string | null;
  corpus_uris?: string[];
  skill_ids?: string[];
  mcp_server_ids?: string[];
}

export interface RoleView {
  id: string;
  name: string;
  description: string;
  greeting: string;
  prompt_id?: string | null;
  corpus_uris: string[];
  skill_ids: string[];
  mcp_server_ids: string[];
  active_codes: number;
  is_builtin: boolean;
}

export async function createRole(
  request: APIRequestContext,
  csrf: string,
  input: CreateRoleInput,
): Promise<RoleView> {
  const res = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: input.name,
      description: input.description ?? '',
      greeting: input.greeting ?? '',
      prompt_id: input.prompt_id ?? null,
      corpus_uris: input.corpus_uris ?? [],
      skill_ids: input.skill_ids ?? [],
      mcp_server_ids: input.mcp_server_ids ?? [],
    },
  });
  if (res.status() !== 201) {
    const body = await res.text();
    throw new Error(`create role failed: ${res.status()} ${body}`);
  }
  return await res.json() as RoleView;
}

export async function getRoleByName(
  request: APIRequestContext,
  name: string,
): Promise<RoleView> {
  const res = await request.get(`${BACKEND}/api/admin/roles/`);
  if (res.status() !== 200) throw new Error(`list roles failed: ${res.status()}`);
  const list = await res.json() as RoleView[];
  const role = list.find((r) => r.name === name);
  if (!role) throw new Error(`role ${name} not found`);
  return role;
}
