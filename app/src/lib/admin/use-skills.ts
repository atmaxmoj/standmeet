// use-skills —— /admin/skills 的状态。zustand store 管 list + status；
// action：create / delete + setCodeSkills (在 CodesSection / CodeCreateModal
// 那边读 attach 列表)。

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export interface SkillView {
  id: string;
  name: string;
  description: string;
  prompt: string;
  source: string;
  is_builtin: boolean;
  created_at: string;
}

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
  createSkill: (input: CreateSkillInput) => Promise<boolean>;
  deleteSkill: (id: string) => Promise<boolean>;
}

export const skillsStore = createResourceStore<SkillView[]>({
  name: 'skills',
  fetcher: () => adminAPI.get<SkillView[]>('/skills/'),
});

export function useSkills(): SkillsHook {
  const r = readResource(skillsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    skills: r.data ?? [],
    error: r.error,
    refresh: skillsStore.getState().refresh,
    createSkill,
    deleteSkill,
  };
}

async function createSkill(input: CreateSkillInput): Promise<boolean> {
  try {
    const created = await adminAPI.post<SkillView>('/skills/', input);
    skillsStore.getState().mutate((prev) => [...(prev ?? []), created]);
    return true;
  } catch {
    return false;
  }
}

async function deleteSkill(id: string): Promise<boolean> {
  try {
    await adminAPI.delete<unknown>(`/skills/${id}`);
    skillsStore.getState().mutate((prev) => (prev ?? []).filter((s) => s.id !== id));
    return true;
  } catch {
    return false;
  }
}

