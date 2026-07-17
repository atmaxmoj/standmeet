// use-skills —— /admin/skills 的状态。zustand store 管 list + status；
// action：create / delete + setCodeSkills (在 CodesSection / CodeCreateModal
// 那边读 attach 列表)。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const SkillViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  source: z.string(),
  is_builtin: z.boolean(),
  enabled: z.boolean().optional().default(true),
  created_at: z.string(),
});
export type SkillView = z.infer<typeof SkillViewSchema>;

export interface CreateSkillInput {
  name: string;
  description: string;
  prompt: string;
}

export interface SkillsHook {
  status: ResourceStatus;
  skills: readonly SkillView[];
  error: string | null;
  refresh: () => Promise<void>;
  createSkill: (input: CreateSkillInput) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  toggleSkill: (id: string, enabled: boolean) => Promise<void>;
}

export const skillsStore = createResourceStore<SkillView[]>({
  name: 'skills',
  fetcher: () => adminAPI.get('/skills/', z.array(SkillViewSchema)),
});

export function useSkills(): SkillsHook {
  const r = useResource(skillsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    skills: r.data ?? [],
    error: r.error,
    refresh: skillsStore.getState().refresh,
    createSkill,
    deleteSkill,
    toggleSkill,
  };
}

// mutation 抛错（不再吞成 false）：调用方用 useAction 收尾（成功 toast / 失败 report），或就地内联。
async function createSkill(input: CreateSkillInput): Promise<void> {
  const created = await adminAPI.post('/skills/', input, SkillViewSchema);
  skillsStore.getState().mutate((prev) => [...(prev ?? []), created]);
}

async function deleteSkill(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/skills/${id}`);
  skillsStore.getState().mutate((prev) => (prev ?? []).filter((s) => s.id !== id));
}

async function toggleSkill(id: string, enabled: boolean): Promise<void> {
  const updated = await adminAPI.patch(`/skills/${id}`, { enabled }, SkillViewSchema);
  skillsStore.getState().mutate((prev) =>
    (prev ?? []).map((s) => s.id === id ? updated : s));
}

