// use-prompts —— /admin/prompts 状态 store + CRUD actions。形态参照
// use-skills（zustand resource store + create/delete actions）。Update 走
// PUT /prompts/{id}。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const PromptViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  body: z.string(),
  is_builtin: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PromptView = z.infer<typeof PromptViewSchema>;

export interface WritePromptInput {
  name: string;
  description: string;
  body: string;
}

export interface PromptsHook {
  status: ResourceStatus;
  prompts: readonly PromptView[];
  error: string | null;
  refresh: () => Promise<void>;
  createPrompt: (input: WritePromptInput) => Promise<PromptView>;
  updatePrompt: (id: string, input: WritePromptInput) => Promise<PromptView>;
  deletePrompt: (id: string) => Promise<void>;
}

export const promptsStore = createResourceStore<PromptView[]>({
  name: 'prompts',
  fetcher: () => adminAPI.get('/prompts/', z.array(PromptViewSchema)),
});

export function usePrompts(): PromptsHook {
  const r = readResource(promptsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    prompts: r.data ?? [],
    error: r.error,
    refresh: promptsStore.getState().refresh,
    createPrompt,
    updatePrompt,
    deletePrompt,
  };
}

// mutation 抛错（不再吞成 null / false）：调用方用 useAction 收尾（成功 toast / 失败 report），或就地内联。
async function createPrompt(input: WritePromptInput): Promise<PromptView> {
  const created = await adminAPI.post('/prompts/', input, PromptViewSchema);
  promptsStore.getState().mutate((prev) => [...(prev ?? []), created]);
  return created;
}

async function updatePrompt(id: string, input: WritePromptInput): Promise<PromptView> {
  const updated = await adminAPI.put(`/prompts/${id}`, input, PromptViewSchema);
  promptsStore.getState().mutate(
    (prev) => (prev ?? []).map((p) => (p.id === id ? updated : p)),
  );
  return updated;
}

async function deletePrompt(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/prompts/${id}`);
  promptsStore.getState().mutate((prev) => (prev ?? []).filter((p) => p.id !== id));
}
