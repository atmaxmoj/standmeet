// admin-mutations.ts —— thin, NAMED setup helpers that seed instance state through the owner admin
// API, so specs don't call the mutating admin API inline (the no-direct-mutating-api rule confines
// that to fixtures/). Each is a plain relocation of the same call a spec used to make; the caller
// passes the same payload object. They assert success (throw on >=300) — that IS the seed's guarantee,
// so a spec's old `expect(res.status()).toBeLessThan(300)` line is subsumed and can be dropped.
//
// These are for SEEDING only. A call that is the ACTION UNDER TEST (a negative/rejection assertion, an
// attacker probe, a diag backdoor) is not a seed — leave it inline with an
// `// eslint-disable-next-line e2e-local/no-direct-mutating-api -- <reason>`, not one of these.

import type { APIRequestContext, APIResponse } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
type Method = 'post' | 'put' | 'patch' | 'delete';

async function seed(
  api: APIRequestContext, method: Method, path: string, csrf: string, data?: unknown,
): Promise<APIResponse> {
  const opts: { headers: Record<string, string>; data?: unknown } = {
    headers: { 'X-Csrftoken': csrf },
  };
  if (data !== undefined) opts.data = data;
  const r = await api[method](`${BACKEND}${path}`, opts);
  if (r.status() >= 300) {
    throw new Error(`admin ${method.toUpperCase()} ${path} seed failed: ${r.status()} ${await r.text()}`);
  }
  return r;
}

// ── résumé drafts (the REST endpoint the composer UI loads; distinct from the MCP resume.* fixtures)
export async function createDraft(
  api: APIRequestContext, csrf: string, data: Record<string, unknown>,
): Promise<{ id: string }> {
  return await (await seed(api, 'post', '/api/admin/drafts', csrf, data)).json() as { id: string };
}
export const updateDraft = (api: APIRequestContext, csrf: string, id: string, data: unknown) =>
  seed(api, 'patch', `/api/admin/drafts/${id}`, csrf, data);

// ── corpus entries (web REST path; distinct from the MCP corpus.* fixtures)
export async function createCorpusEntry(
  api: APIRequestContext, csrf: string, genre: string, data: Record<string, unknown>,
): Promise<{ id: string }> {
  return await (await seed(api, 'post', `/api/admin/corpus/${genre}`, csrf, data)).json() as { id: string };
}
export const updateCorpusEntry = (api: APIRequestContext, csrf: string, genre: string, id: string, data: unknown) =>
  seed(api, 'patch', `/api/admin/corpus/${genre}/${id}`, csrf, data);
export const deleteCorpusEntry = (api: APIRequestContext, csrf: string, genre: string, id: string) =>
  seed(api, 'delete', `/api/admin/corpus/${genre}/${id}`, csrf);
export const setEntrySeo = (api: APIRequestContext, csrf: string, genre: string, id: string, data: unknown) =>
  seed(api, 'patch', `/api/admin/corpus/${genre}/${id}/seo`, csrf, data);

// ── roles / prompts / skills updates + deletes
export const updateRole = (api: APIRequestContext, csrf: string, id: string, data: unknown) =>
  seed(api, 'put', `/api/admin/roles/${id}`, csrf, data);
export const updatePrompt = (api: APIRequestContext, csrf: string, id: string, data: unknown) =>
  seed(api, 'put', `/api/admin/prompts/${id}`, csrf, data);
export async function createSkill(
  api: APIRequestContext, csrf: string, data: Record<string, unknown>,
): Promise<{ id: string }> {
  return await (await seed(api, 'post', '/api/admin/skills/', csrf, data)).json() as { id: string };
}
export const updateSkill = (api: APIRequestContext, csrf: string, id: string, data: unknown) =>
  seed(api, 'put', `/api/admin/skills/${id}`, csrf, data);

// ── embeds
export async function createEmbed(
  api: APIRequestContext, csrf: string, data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return await (await seed(api, 'post', '/api/admin/embeds', csrf, data)).json() as Record<string, unknown>;
}
export const deleteEmbed = (api: APIRequestContext, csrf: string, id: string) =>
  seed(api, 'delete', `/api/admin/embeds/${id}`, csrf);

// ── microsites (create / rename / write a file)
export async function createMicrosite(
  api: APIRequestContext, csrf: string, data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return await (await seed(api, 'post', '/api/admin/microsites/', csrf, data)).json() as Record<string, unknown>;
}

// ── account (owner self-service)
export const changeAccountEmail = (api: APIRequestContext, csrf: string, data: unknown) =>
  seed(api, 'patch', '/api/admin/account/email', csrf, data);
export const changeAccountPassword = (api: APIRequestContext, csrf: string, data: unknown) =>
  seed(api, 'patch', '/api/admin/account/password', csrf, data);
export const requestRecovery = (api: APIRequestContext, csrf: string) =>
  seed(api, 'post', '/api/admin/account/recovery', csrf, {});

// ── security / infra admin
export const addIpBan = (api: APIRequestContext, csrf: string, data: unknown) =>
  seed(api, 'post', '/api/admin/ip-bans/', csrf, data);
export const removeIpBan = (api: APIRequestContext, csrf: string, id: string) =>
  seed(api, 'delete', `/api/admin/ip-bans/${id}`, csrf);
export const approveAccessRequest = (api: APIRequestContext, csrf: string, id: string) =>
  seed(api, 'post', `/api/admin/access-requests/${id}/approve`, csrf, {});

// ── mcp servers
export async function createMcpServer(
  api: APIRequestContext, csrf: string, data: Record<string, unknown>,
): Promise<{ id: string }> {
  return await (await seed(api, 'post', '/api/admin/mcp-servers', csrf, data)).json() as { id: string };
}
export const grantMcpDep = (api: APIRequestContext, csrf: string, serverID: string, data: unknown) =>
  seed(api, 'post', `/api/admin/mcp-servers/${serverID}/dep-grants`, csrf, data);
