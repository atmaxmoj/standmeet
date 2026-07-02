// codes.ts —— admin POST /api/admin/codes 创建 access code 的 helper。
//
// A.3-IAM-5: code 只挂 assumed_role_id；不传时 backend 默认绑 owner 的 vanilla
// role。ACL 测试请配合 fixtures/roles.ts 先建一个 role 再传 assumed_role_id。

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface CreateCodeInput {
  code: string;
  label: string;
  purpose?: string;
  assumed_role_id?: string | null;
  prompt_id?: string | null;
  ghosts?: string[];
  max_members?: number | null;
  max_turns_per_session?: number | null;
  max_bookings?: number | null;
}

export interface CodeView {
  id: string;
  code: string;
  label: string;
  status: string;
  assumed_role_id: string;
  prompt_id?: string | null;
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
      ghosts: input.ghosts ?? [],
      max_members: input.max_members ?? null,
      max_turns_per_session: input.max_turns_per_session ?? null,
      max_bookings: input.max_bookings ?? null,
      assumed_role_id: input.assumed_role_id ?? null,
      prompt_id: input.prompt_id ?? null,
    },
  });
  if (res.status() !== 201) throw new Error(`create code failed: ${res.status()}`);
  return await res.json() as CodeView;
}
