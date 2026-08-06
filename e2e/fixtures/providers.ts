// providers.ts —— the owner's provider book: `POST/GET/PATCH/DELETE /api/admin/providers`.
//
// One owner used to hold exactly one provider (four columns on `owners`). It is now a list with
// one default, and a code or a role may point at another entry; resolution is
// `byoai > code > role > default`.
//
// Creating one carries a RAW API key, so — like the `ai_provider.set` op it replaces — that route
// lives on the admin facade only, never on owner MCP. The read/flag/delete calls carry no secret.

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface CreateProviderInput {
  label: string;
  provider: string;       // preset name ('anthropic' / 'custom' / …)
  endpoint?: string;
  model?: string;
  key?: string;
  is_default?: boolean;
}

export interface ProviderView {
  id: string;
  label: string;
  provider: string;
  endpoint: string;
  model: string;
  key_configured: boolean; // the key itself is never returned
  is_default: boolean;
  gas_tokens?: number | null;
}

export async function createProvider(
  request: APIRequestContext, csrf: string, input: CreateProviderInput,
): Promise<ProviderView> {
  const res = await request.post(`${BACKEND}/api/admin/providers/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      label: input.label,
      provider: input.provider,
      endpoint: input.endpoint ?? '',
      model: input.model ?? '',
      key: input.key ?? '',
      is_default: input.is_default ?? false,
    },
  });
  if (res.status() !== 201) {
    throw new Error(`create provider failed: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as ProviderView;
}

export async function listProviders(request: APIRequestContext): Promise<ProviderView[]> {
  const res = await request.get(`${BACKEND}/api/admin/providers/`);
  if (res.status() !== 200) throw new Error(`list providers failed: ${res.status()}`);
  return await res.json() as ProviderView[];
}

/** Status only — deleting the default must be refused, and a spec asserting that needs the code,
 *  not an exception. */
export async function deleteProviderStatus(
  request: APIRequestContext, csrf: string, id: string,
): Promise<number> {
  const res = await request.delete(`${BACKEND}/api/admin/providers/${id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  return res.status();
}

export async function setDefaultProvider(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/providers/${id}/default`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  if (res.status() !== 200) {
    throw new Error(`set default provider failed: ${res.status()} ${await res.text()}`);
  }
}
