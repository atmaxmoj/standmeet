// codes.ts —— admin POST /api/admin/codes 创建 access code 的 helper。

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// PathPermission —— retrieval-redesign 后的 ACL 单元：first-match-wins by
// order ascending；default deny。空列表 → 全允许 (legacy 兼容)。
interface PathPermission {
  action: 'allow' | 'deny';
  path_pattern: string;
  order?: number;
}

export interface CreateCodeInput {
  code: string;
  label: string;
  purpose?: string;
  // included_tags/excluded_tags 仍接受，retrieval-redesign 落地后将忽略。
  // 留入参为现存 spec 不破坏；新 spec 请用 corpus_permissions。
  included_tags?: string[];
  excluded_tags?: string[];
  corpus_permissions?: PathPermission[];
  suggested_questions?: string[];
  max_sessions_per_member?: number | null;
  max_turns_per_session?: number | null;
}

export interface CodeView {
  id: string;
  code: string;
  label: string;
  status: string;
}

export async function createCode(
  request: APIRequestContext,
  csrf: string,
  input: CreateCodeInput,
): Promise<CodeView> {
  const res = await request.post(`${BACKEND}/api/admin/codes`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      code: input.code,
      label: input.label,
      purpose: input.purpose ?? '',
      included_tags: input.included_tags ?? [],
      excluded_tags: input.excluded_tags ?? [],
      corpus_permissions: input.corpus_permissions ?? [],
      suggested_questions: input.suggested_questions ?? [],
      max_sessions_per_member: input.max_sessions_per_member ?? null,
      max_turns_per_session: input.max_turns_per_session ?? null,
    },
  });
  if (res.status() !== 201) throw new Error(`create code failed: ${res.status()}`);
  return await res.json() as CodeView;
}
