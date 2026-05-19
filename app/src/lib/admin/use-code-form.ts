// use-code-form —— CodeCreateForm / CodeCreateModal 共用的状态。
// scope / excluded 是互斥的 tag 集合。suggested questions 是 string[]。

import { useCallback, useState } from 'react';

import type { CodeView, CreateCodeInput } from '@/lib/admin/use-codes';

export interface CodeFormState {
  code: string;
  label: string;
  purpose: string;
  scope: string[];
  excluded: string[];
  suggested: string[];
  maxSessions: string; // raw input — '5'，空字符串等于 unlimited
  maxTurns: string;
}

const EMPTY: CodeFormState = {
  code: '', label: '', purpose: '',
  scope: [], excluded: [], suggested: ['', ''],
  maxSessions: '', maxTurns: '',
};

export interface CodeFormHook {
  values: CodeFormState;
  setCode: (v: string) => void;
  setLabel: (v: string) => void;
  setPurpose: (v: string) => void;
  setMaxSessions: (v: string) => void;
  setMaxTurns: (v: string) => void;
  toggleInclude: (t: string) => void;
  toggleExclude: (t: string) => void;
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

  const toggleInclude = useCallback((t: string) => {
    setValues((v) => moveToScope(v, t));
  }, []);

  const toggleExclude = useCallback((t: string) => {
    setValues((v) => moveToExcluded(v, t));
  }, []);

  const updateQ = useCallback((i: number, txt: string) => {
    setValues((v) => ({ ...v, suggested: v.suggested.map((q, j) => j === i ? txt : q) }));
  }, []);

  const addQ = useCallback(() => setValues((v) => ({ ...v, suggested: [...v.suggested, ''] })), []);
  const removeQ = useCallback((i: number) => {
    setValues((v) => ({ ...v, suggested: v.suggested.filter((_, j) => j !== i) }));
  }, []);

  const reset = useCallback(() => setValues(EMPTY), []);
  const toInput = useCallback(() => buildInput(values), [values]);

  return {
    values, setCode, setLabel, setPurpose, setMaxSessions, setMaxTurns,
    toggleInclude, toggleExclude, updateQ, addQ, removeQ, reset, toInput,
  };
}

function seed(initial?: Partial<CodeView>): CodeFormState {
  return {
    code:    initial?.code ?? '',
    label:   initial?.label ?? '',
    purpose: initial?.purpose ?? '',
    scope:    [...(initial?.included_tags ?? [])],
    excluded: [...(initial?.excluded_tags ?? [])],
    suggested: initial?.suggested_questions?.length
      ? [...initial.suggested_questions]
      : ['', ''],
    maxSessions: numOrEmpty(initial?.max_sessions_per_member),
    maxTurns:    numOrEmpty(initial?.max_turns_per_session),
  };
}

function numOrEmpty(n: number | null | undefined): string {
  return typeof n === 'number' && n > 0 ? String(n) : '';
}

function moveToScope(v: CodeFormState, t: string): CodeFormState {
  const inScope = v.scope.includes(t);
  return {
    ...v,
    scope: inScope ? v.scope.filter((x) => x !== t) : [...v.scope, t],
    excluded: v.excluded.filter((x) => x !== t),
  };
}

function moveToExcluded(v: CodeFormState, t: string): CodeFormState {
  const inExc = v.excluded.includes(t);
  return {
    ...v,
    excluded: inExc ? v.excluded.filter((x) => x !== t) : [...v.excluded, t],
    scope: v.scope.filter((x) => x !== t),
  };
}

function buildInput(v: CodeFormState): CreateCodeInput {
  return {
    code: v.code.trim(),
    label: v.label.trim(),
    purpose: v.purpose.trim(),
    included_tags: v.scope.filter(Boolean),
    excluded_tags: v.excluded.filter(Boolean),
    suggested_questions: v.suggested.map((q) => q.trim()).filter(Boolean),
    max_sessions_per_member: parseQuota(v.maxSessions),
    max_turns_per_session: parseQuota(v.maxTurns),
  };
}

function parseQuota(raw: string): number | null {
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
