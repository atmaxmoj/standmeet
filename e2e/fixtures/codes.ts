// codes.ts —— helper for admin POST /api/admin/codes to create an access code.
//
// A.3-IAM-5: a code only carries assumed_role_id; when unset the backend
// defaults to binding the owner's public role. For ACL tests, pair with
// fixtures/roles.ts to create a role first, then pass assumed_role_id.

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

// revokeCode —— revoke a code. Revoked and non-existent are **two different**
// rejections (F-D-6 split the merged "invalid or revoked": someone who mistyped
// re-pastes, someone whose code was revoked goes and asks for a new one), so a
// spec on the visitor side needs to be able to really produce the "revoked" state.
export async function revokeCode(
  request: APIRequestContext, csrf: string, codeID: string,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/codes/${codeID}/revoke`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`revoke code failed: ${res.status()}`);
}
