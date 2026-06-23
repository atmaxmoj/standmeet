// code-denials.ts —— ACL hierarchy 的 code 层（capability-acl-hierarchy.md）。
//
// 模型：纯 AND·code-deny。code 只能从所选 role 里**减**（presence=deny，无 state）。
// 稀疏表 code_capability_denials / code_skill_denials；issue 时跟 role grant 集相减
// （applyCodeDenials）再冻进 RoleSnapshot。
//
// 契约（admin 子路由，land 在 routes/admin/codes.go；实现前这些调用拿 404 → ACL 测试红）：
//   POST   /api/admin/codes/{codeId}/capability-denials  body {capability_id}  → 201；缺字段 400；重复幂等 200
//   DELETE /api/admin/codes/{codeId}/capability-denials/{capId}                → 204（撤销 deny）
//   POST   /api/admin/codes/{codeId}/skill-denials        body {skill_id}      → 201
//   DELETE /api/admin/codes/{codeId}/skill-denials/{skillId}                   → 204
//   GET    /api/admin/codes/{codeId}/denials  → { capability_ids: [], skill_ids: [] }
//
// 跨 owner 的 codeId → 404/403（互不串）。无 CSRF → 403。code 已 revoke → deny 仍可写但无意义。

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface CodeDenials {
  capability_ids: string[];
  skill_ids: string[];
}

/** Deny a capability for this code (narrow it out of the role). Returns HTTP
 *  status so callers can assert success (201) + error paths (400/403/404). */
export async function setCodeCapabilityDenial(
  request: APIRequestContext, csrf: string, codeId: string, capabilityId: string,
): Promise<number> {
  const res = await request.post(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/capability-denials`,
    { data: { capability_id: capabilityId }, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Deny a skill for this code. Returns HTTP status. */
export async function setCodeSkillDenial(
  request: APIRequestContext, csrf: string, codeId: string, skillId: string,
): Promise<number> {
  const res = await request.post(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/skill-denials`,
    { data: { skill_id: skillId }, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Raw POST to the capability-denials route with an arbitrary body —— for the
 *  malformed-body error spec (missing capability_id → 400). */
export async function postCodeCapabilityDenialRaw(
  request: APIRequestContext, csrf: string, codeId: string, body: Record<string, unknown>,
): Promise<number> {
  const res = await request.post(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/capability-denials`,
    { data: body, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Remove a capability deny (un-deny). Returns HTTP status (204 on success). */
export async function clearCodeCapabilityDenial(
  request: APIRequestContext, csrf: string, codeId: string, capabilityId: string,
): Promise<number> {
  const res = await request.delete(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/capability-denials/${encodeURIComponent(capabilityId)}`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Read back the code's deny sets (admin UI read path). */
export async function listCodeDenials(
  request: APIRequestContext, csrf: string, codeId: string,
): Promise<CodeDenials> {
  const res = await request.get(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/denials`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  if (res.status() !== 200) throw new Error(`list code denials: ${res.status()}`);
  return await res.json() as CodeDenials;
}
