// use-public-conversation-policy —— how codeless (public/byoai) conversations are kept: saved at
// all (save=false → never stored), and a scheduled prune of idle ones (prune_cron '' = off).
// GET/PUT /api/admin/public-conversation-policy. Coded conversations are never affected.

'use client';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';

const PolicySchema = z.object({
  save: z.boolean(),
  prune_cron: z.string(),
  retention_days: z.number(),
  last_run_at: z.string(),
});

export type PublicConversationPolicy = z.infer<typeof PolicySchema>;
export type PolicyInput = Pick<PublicConversationPolicy, 'save' | 'prune_cron' | 'retention_days'>;

export const publicPolicyStore = createResourceStore<PublicConversationPolicy>({
  name: 'public-conversation-policy',
  fetcher: () => adminAPI.get('/public-conversation-policy', PolicySchema),
});

export function usePublicConversationPolicy() {
  const r = useResource(publicPolicyStore);
  const save = async (next: PolicyInput): Promise<void> => {
    publicPolicyStore.getState().mutate(
      await adminAPI.put('/public-conversation-policy', next, PolicySchema),
    );
  };
  return { data: r.data ?? null, save };
}
