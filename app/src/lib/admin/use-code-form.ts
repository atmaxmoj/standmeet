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
  // grantedSkills —— agent capability identifiers (e.g. 'calendar.book').
  // 空 array = code 持有者在 chat 里不能调任何带副作用的 agent skill。
  grantedSkills: string[];
  // maxBookings —— calendar.book quota per code; '' = nil (没解锁 calendar.book
  // 时是 nil；解锁但要无限就 '' 也行)。string 形态便于跟 input 字段双绑。
  maxBookings: string;
  skillIDs: string[];
  // assumedRoleID —— A.3-IAM。owner 选 "role: ..." dropdown 时填；为空表示
  // legacy 路径（走 corpus_permissions / granted_skills / skill_ids）。
  assumedRoleID: string;
}

const EMPTY: CodeFormState = {
  code: '', label: '', purpose: '',
  permissionsRaw: '', suggested: ['', ''],
  maxSessions: '', maxTurns: '', grantedSkills: [], maxBookings: '',
  skillIDs: [],
  assumedRoleID: '',
};

export interface CodeFormHook {
  values: CodeFormState;
  setCode: (v: string) => void;
  setLabel: (v: string) => void;
  setPurpose: (v: string) => void;
  setMaxSessions: (v: string) => void;
  setMaxTurns: (v: string) => void;
  setMaxBookings: (v: string) => void;
  setPermissionsRaw: (v: string) => void;
  setAssumedRoleID: (v: string) => void;
  toggleSkill: (id: string) => void;
  toggleGrantedSkill: (name: string) => void;
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
  const setMaxBookings = useCallback(
    (maxBookings: string) => setValues((v) => ({ ...v, maxBookings })), [],
  );
  const setPermissionsRaw = useCallback(
    (permissionsRaw: string) => setValues((v) => ({ ...v, permissionsRaw })), [],
  );
  const setAssumedRoleID = useCallback(
    (assumedRoleID: string) => setValues((v) => ({ ...v, assumedRoleID })), [],
  );

  const toggleGrantedSkill = useCallback((name: string) => {
    setValues((v) => ({
      ...v,
      grantedSkills: v.grantedSkills.includes(name)
        ? v.grantedSkills.filter((s) => s !== name)
        : [...v.grantedSkills, name],
    }));
  }, []);

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
    setMaxBookings, setPermissionsRaw, setAssumedRoleID,
    toggleSkill, toggleGrantedSkill,
    updateQ, addQ, removeQ, reset, toInput,
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
    maxSessions:   numOrEmpty(initial?.max_sessions_per_member),
    maxTurns:      numOrEmpty(initial?.max_turns_per_session),
    maxBookings:   numOrEmpty(initial?.max_bookings),
    grantedSkills: initial?.granted_skills ? [...initial.granted_skills] : [],
    skillIDs:      initial?.skill_ids ? [...initial.skill_ids] : [],
    assumedRoleID: initial?.assumed_role_id ?? '',
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
    max_bookings: parseQuota(v.maxBookings),
    granted_skills: [...v.grantedSkills],
    skill_ids: [...v.skillIDs],
    assumed_role_id: v.assumedRoleID === '' ? null : v.assumedRoleID,
  };
}

function parseQuota(raw: string): number | null {
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
