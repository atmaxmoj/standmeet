// use-api-keys —— state machine for the **outbound API key** block on
// /admin/api-mcp (F-K-1).
//
// Don't confuse this with its neighbor use-tokens — they're two different
// things ([[two-mcp-surfaces]]):
//   - use-tokens manages the **MCP keypair** (Ed25519, used by the owner's own client to sign)
//   - this file manages the **outbound `smk_` key** (used by third-party programs to hit `/api/pub/v1`)
//
// Before this existed, outbound keys lived only on owner-MCP, so **a leaked
// key could only be revoked after the owner had installed and run an MCP
// client**. The bleeding-stop path shouldn't require installing a tool first.
//
// The plaintext secret is shown exactly once, at mint time (justCreated);
// after that only the prefix remains in the list — this page must not become a place someone can scrape keys from.

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const APIKeySchema = z.object({
  id: z.string(),
  label: z.string(),
  prefix: z.string(),
  status: z.string(),
  assumed_role_id: z.string(),
  rate_limit_rpm: z.number().nullable().optional(),
  last_used_at: z.string().optional(),
  created_at: z.string(),
});
export type APIKeyItem = z.infer<typeof APIKeySchema>;

// The shape of one mint event: **secret only ever appears here**.
const CreatedAPIKeySchema = z.object({
  id: z.string(),
  prefix: z.string(),
  secret: z.string(),
});
export type CreatedAPIKey = z.infer<typeof CreatedAPIKeySchema>;

export interface APIKeysHook {
  status: ResourceStatus;
  keys: readonly APIKeyItem[];
  justCreated: CreatedAPIKey | null;
  error: string | null;
  createKey: (label: string, roleID: string) => Promise<void>;
  revokeKey: (id: string) => Promise<void>;
  dismissCreated: () => void;
}

const keysStore = createResourceStore<APIKeyItem[]>({
  name: 'api-keys',
  fetcher: () => adminAPI.get('/api-keys', z.array(APIKeySchema)),
});

// justCreated is **local to the component**, a one-time state that never enters the store.
//
// This is deliberate: leave this page and come back, and that plaintext
// secret should be gone — it's given exactly once, at mint time, and after
// that even the product itself can't retrieve it again. Putting it in the
// store would let it live across pages, which is exactly "the list becomes a place to scrape keys from".
export function useAPIKeys(): APIKeysHook {
  const res = useResource(keysStore);
  const [justCreated, setJustCreated] = useState<CreatedAPIKey | null>(null);
  // The first mount needs to actually fetch once — a resource store doesn't
  // start itself. Without this line, the panel renders, the header is there,
  // **only the list stays empty forever**: a "looks fine" shape.
  const { ensureLoaded } = res;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: res.status,
    keys: res.data ?? [],
    justCreated,
    error: res.error,
    createKey: async (label, roleID) => {
      const created = await adminAPI.post(
        '/api-keys', { label, assumed_role_id: roleID }, CreatedAPIKeySchema,
      );
      setJustCreated(created);
      await keysStore.getState().refresh();
    },
    revokeKey: async (id) => {
      await adminAPI.post(`/api-keys/${id}/revoke`, {}, z.unknown());
      await keysStore.getState().refresh();
    },
    dismissCreated: () => { setJustCreated(null); },
  };
}
