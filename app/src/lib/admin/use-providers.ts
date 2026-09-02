// use-providers —— the owner's provider registry (/admin/providers).
//
// One registry per owner, one of whose entries is the **default**. A code
// and a role can each point at one, resolved in order `byoai > code > role >
// default`. Deleting a referenced entry doesn't require unlinking it first —
// the reference goes null and falls back to the default on read; the default
// entry itself can't be deleted (backend returns 409), and this file doesn't
// pre-judge that — the human-readable message comes from the backend.
//
// The key is write-only, never read back: create sends the plaintext key, the list only ever shows key_configured.

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const ProviderViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  endpoint: z.string(),
  model: z.string(),
  key_configured: z.boolean(),
  is_default: z.boolean(),
  // gas_tokens —— **how much was added** to this tank; null = unmetered (#7).
  gas_tokens: z.number().nullable(),
  // gas_remaining —— how much is left (derived on read, no counter column). null = unmetered.
  gas_remaining: z.number().nullable(),
});
export type ProviderView = z.infer<typeof ProviderViewSchema>;

export interface CreateProviderInput {
  label: string;
  provider: string;
  endpoint: string;
  model: string;
  key: string;
  is_default?: boolean;
}

export interface ProvidersHook {
  status: ResourceStatus;
  providers: readonly ProviderView[];
  error: string | null;
  refresh: () => Promise<void>;
  createProvider: (input: CreateProviderInput) => Promise<ProviderView>;
  setDefaultProvider: (id: string) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  setGas: (id: string, tokens: number | null) => Promise<void>;
}

export const providersStore = createResourceStore<ProviderView[]>({
  name: 'providers',
  fetcher: () => adminAPI.get('/providers/', z.array(ProviderViewSchema)),
});

export function useProviders(): ProvidersHook {
  const r = useResource(providersStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    providers: r.data ?? [],
    error: r.error,
    refresh: providersStore.getState().refresh,
    createProvider,
    setDefaultProvider,
    deleteProvider,
    setGas,
  };
}

// The mutation throws: the caller finishes up with useAction (success toast / failure report).

async function createProvider(input: CreateProviderInput): Promise<ProviderView> {
  const created = await adminAPI.post('/providers/', input, ProviderViewSchema);
  // If the newly created entry becomes the default, the previous one no
  // longer is — update both locally so the list never shows two defaults.
  providersStore.getState().mutate((prev) =>
    [...clearDefaultIf(created.is_default, prev ?? []), created]);
  return created;
}

// setDefaultProvider —— the backend returns {ok:true}, not the row itself; so this moves the flag locally.
async function setDefaultProvider(id: string): Promise<void> {
  await adminAPI.postVoid(`/providers/${id}/default`, {});
  providersStore.getState().mutate((prev) =>
    (prev ?? []).map((p) => ({ ...p, is_default: p.id === id })));
}

async function deleteProvider(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/providers/${id}`);
  providersStore.getState().mutate((prev) => (prev ?? []).filter((p) => p.id !== id));
}

// setGas —— add fuel / remove the meter. null = unmetered (removes the meter from this tank).
async function setGas(id: string, tokens: number | null): Promise<void> {
  const updated = await adminAPI.patch(
    `/providers/${id}`, { gas_tokens: tokens }, ProviderViewSchema,
  );
  providersStore.getState().mutate((prev) =>
    (prev ?? []).map((p) => p.id === updated.id ? updated : p));
}

function clearDefaultIf(
  moved: boolean, rows: readonly ProviderView[],
): ProviderView[] {
  return moved ? rows.map((p) => ({ ...p, is_default: false })) : [...rows];
}
