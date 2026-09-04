// code-denials.ts —— the code layer of the ACL hierarchy (capability-acl-hierarchy.md).
//
// Model: pure AND·code-deny. A code can only **subtract** from the chosen role
// (presence=deny, no state). Sparse tables code_capability_denials /
// code_skill_denials; at issue time they're subtracted from the role's grant set
// (applyCodeDenials) and frozen into the RoleSnapshot.
//
// Contract (admin sub-routes, landing in routes/admin/codes.go; before they're
// implemented these calls get 404 → the ACL tests are red):
//   POST   /api/admin/codes/{codeId}/denials/capability  body {capability_id}  → 201; missing field 400; duplicate idempotent 200
//   DELETE /api/admin/codes/{codeId}/denials/capability/{capId}                → 204 (undo deny)
//   POST   /api/admin/codes/{codeId}/denials/skill        body {skill_id}      → 201
//   DELETE /api/admin/codes/{codeId}/denials/skill/{skillId}                   → 204
//   GET    /api/admin/codes/{codeId}/denials  → { capability_ids: [], skill_ids: [] }
//
// A codeId from another owner → 404/403 (no cross-tenant leak). No CSRF → 403.
// A revoked code → a deny is still writable but meaningless.

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
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/denials/capability`,
    { data: { capability_id: capabilityId }, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Deny a skill for this code. Returns HTTP status. */
export async function setCodeSkillDenial(
  request: APIRequestContext, csrf: string, codeId: string, skillId: string,
): Promise<number> {
  const res = await request.post(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/denials/skill`,
    { data: { skill_id: skillId }, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Raw POST to the denials/capability route with an arbitrary body —— for the
 *  malformed-body error spec (missing capability_id → 400). */
export async function postCodeCapabilityDenialRaw(
  request: APIRequestContext, csrf: string, codeId: string, body: Record<string, unknown>,
): Promise<number> {
  const res = await request.post(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/denials/capability`,
    { data: body, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Remove a capability deny (un-deny). Returns HTTP status (204 on success). */
export async function clearCodeCapabilityDenial(
  request: APIRequestContext, csrf: string, codeId: string, capabilityId: string,
): Promise<number> {
  const res = await request.delete(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/denials/capability/${encodeURIComponent(capabilityId)}`,
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

/** Read the code's deny sets, returning the raw HTTP status (for the not-yours / 4xx paths). */
export async function listCodeDenialsStatus(
  request: APIRequestContext, csrf: string, codeId: string,
): Promise<number> {
  const res = await request.get(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/denials`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}

/** Replace the whole corpus-denial list for a code. Returns HTTP status. */
export async function setCodeCorpusDenials(
  request: APIRequestContext, csrf: string, codeId: string, uris: readonly string[],
): Promise<number> {
  const res = await request.put(
    `${BACKEND}/api/admin/codes/${encodeURIComponent(codeId)}/denials/corpus`,
    { data: { uris: [...uris] }, headers: { 'X-Csrftoken': csrf } },
  );
  return res.status();
}
