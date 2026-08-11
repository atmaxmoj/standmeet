// codes.ts —— admin POST /api/admin/codes 创建 access code 的 helper。
//
// A.3-IAM-5: code 只挂 assumed_role_id；不传时 backend 默认绑 owner 的 public
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
  // provider_id —— this code's inference provider. Unset = inherit (role, then the owner's
  // default). The code wins over the role: it is the ticket that was handed out.
  provider_id?: string | null;
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
      provider_id: input.provider_id ?? null,
    },
  });
  if (res.status() !== 201) throw new Error(`create code failed: ${res.status()}`);
  return await res.json() as CodeView;
}

// revokeCode —— 撤销一张码。被撤销跟不存在是**两种**拒绝（F-D-6 把那句合成的
// "invalid or revoked" 拆开了：打错字的人重新粘一次，被撤销的人去要一张新码），
// 所以走访客那一侧的 spec 需要能真造出「被撤销」这个状态。
export async function revokeCode(
  request: APIRequestContext, csrf: string, codeID: string,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/codes/${codeID}/revoke`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`revoke code failed: ${res.status()}`);
}
