// fixtures/sandbox.ts —— helpers for the per-session sandbox workspace lifecycle
// (#148). Backend exposes them as /internal/diag/sandbox/* test hooks (no auth,
// same as /diag/registry): set the backend-controlled TTL, run the cron sweep on
// demand, and list active per-session workspaces (the admin sandbox panel's data).

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface SandboxWorkspace {
  id: string;
  mod_time: string;
  age_secs: number;
}

// setSandboxWorkspaceTTL —— set the backend-controlled retention. csrf is accepted
// for call-site symmetry with other admin helpers; the /internal hook needs none.
export async function setSandboxWorkspaceTTL(
  request: APIRequestContext, _csrf: string, opts: { seconds: number },
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/internal/diag/sandbox/workspace-ttl`,
    { data: { seconds: opts.seconds } },
  );
  if (res.status() !== 200) {
    throw new Error(`set workspace ttl: ${res.status()} ${await res.text()}`);
  }
}

// runSandboxWorkspaceSweep —— run the cron sweep now (deletes expired workspaces).
export async function runSandboxWorkspaceSweep(
  request: APIRequestContext,
): Promise<number> {
  const res = await request.post(`${BACKEND}/internal/diag/sandbox/sweep`);
  if (res.status() !== 200) {
    throw new Error(`sandbox sweep: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json() as { removed: number };
  return body.removed;
}

// listSandboxWorkspaces —— active per-session workspace dirs.
export async function listSandboxWorkspaces(
  request: APIRequestContext,
): Promise<SandboxWorkspace[]> {
  const res = await request.get(`${BACKEND}/internal/diag/sandbox/workspaces`);
  if (res.status() !== 200) {
    throw new Error(`list workspaces: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json() as { workspaces: SandboxWorkspace[] };
  return body.workspaces;
}
