// use-code-form —— CodeCreateForm / CodeCreateModal 共用的状态。
//
// retrieval-redesign 后：tag-based scope/excluded 改成 corpus_permissions
// (path-glob ACL)。permissionsRaw 是一行一条 JSON-shape 文本，owner 直接编辑
// (admin UI 简单可视化 follow-up)。

import { useCallback, useState } from 'react';

import { z } from 'zod';

import type { CodeView, CreateCodeInput, PathPermission } from '@/lib/admin/use-codes';

const PathPermArraySchema = z.array(z.object({
  action: z.enum(['allow', 'deny']), path_pattern: z.string(), order: z.number().optional(),
}));

export interface CodeFormState {
  code: string;
  label: string;
  purpose: string;
  permissionsRaw: string; // JSON array of PathPermission, 一行一条人类可读
  suggested: string[];
  maxSessions: string;
  maxTurns: string;
  skillIDs: string[];
}

const EMPTY: CodeFormState = {
  code: '', label: '', purpose: '',
  permissionsRaw: '', suggested: ['', ''],
  maxSessions: '', maxTurns: '', skillIDs: [],
};

export interface CodeFormHook {
  values: CodeFormState;
  setCode: (v: string) => void;
  setLabel: (v: string) => void;
  setPurpose: (v: string) => void;
  setMaxSessions: (v: string) => void;
  setMaxTurns: (v: string) => void;
  setPermissionsRaw: (v: string) => void;
  toggleSkill: (id: string) => void;
  updateQ: (i: number, v: string) => void;
  addQ: () => void;
  removeQ: (i: number) => void;
  reset: () => void;
  toInput: () => CreateCodeInput;
}

export function useCodeForm(initial?: Partial<CodeView>): CodeFormHook {
  const [values, setValues] = useState<CodeFormState>(() => seed(initial));

  const setCode    = useCallback((code: string) => setValues((v) => ({ ...v, code })), []);
  const setLabel   = useCallback((label: string) => setValues((v) => ({ ...v, label })), []);
  const setPurpose = useCallback((purpose: string) => setValues((v) => ({ ...v, purpose })), []);
  const setMaxSessions = useCallback(
    (maxSessions: string) => setValues((v) => ({ ...v, maxSessions })), [],
  );
  const setMaxTurns = useCallback(
    (maxTurns: string) => setValues((v) => ({ ...v, maxTurns })), [],
  );
  const setPermissionsRaw = useCallback(
    (permissionsRaw: string) => setValues((v) => ({ ...v, permissionsRaw })), [],
  );

  const updateQ = useCallback((i: number, txt: string) => {
    setValues((v) => ({ ...v, suggested: v.suggested.map((q, j) => j === i ? txt : q) }));
  }, []);

  const addQ = useCallback(() => setValues((v) => ({ ...v, suggested: [...v.suggested, ''] })), []);
  const removeQ = useCallback((i: number) => {
    setValues((v) => ({ ...v, suggested: v.suggested.filter((_, j) => j !== i) }));
  }, []);

  const toggleSkill = useCallback((id: string) => {
    setValues((v) => ({
      ...v,
      skillIDs: v.skillIDs.includes(id)
        ? v.skillIDs.filter((s) => s !== id)
        : [...v.skillIDs, id],
    }));
  }, []);

  const reset = useCallback(() => setValues(EMPTY), []);
  const toInput = useCallback(() => buildInput(values), [values]);

  return {
    values, setCode, setLabel, setPurpose, setMaxSessions, setMaxTurns,
    setPermissionsRaw, toggleSkill, updateQ, addQ, removeQ, reset, toInput,
  };
}

function seed(initial?: Partial<CodeView>): CodeFormState {
  return {
    code:    initial?.code ?? '',
    label:   initial?.label ?? '',
    purpose: initial?.purpose ?? '',
    permissionsRaw: stringifyPermissions(initial?.corpus_permissions ?? []),
    suggested: initial?.suggested_questions?.length
      ? [...initial.suggested_questions]
      : ['', ''],
    maxSessions: numOrEmpty(initial?.max_sessions_per_member),
    maxTurns:    numOrEmpty(initial?.max_turns_per_session),
    skillIDs:    initial?.skill_ids ? [...initial.skill_ids] : [],
  };
}

function stringifyPermissions(perms: PathPermission[]): string {
  if (perms.length === 0) return '';
  return JSON.stringify(perms, null, 2);
}

function parsePermissions(raw: string): PathPermission[] {
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  try {
    const result = PathPermArraySchema.safeParse(JSON.parse(trimmed));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function numOrEmpty(n: number | null | undefined): string {
  return typeof n === 'number' && n > 0 ? String(n) : '';
}

function buildInput(v: CodeFormState): CreateCodeInput {
  return {
    code: v.code.trim(),
    label: v.label.trim(),
    purpose: v.purpose.trim(),
    corpus_permissions: parsePermissions(v.permissionsRaw),
    suggested_questions: v.suggested.map((q) => q.trim()).filter(Boolean),
    max_sessions_per_member: parseQuota(v.maxSessions),
    max_turns_per_session: parseQuota(v.maxTurns),
    skill_ids: [...v.skillIDs],
  };
}

function parseQuota(raw: string): number | null {
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
