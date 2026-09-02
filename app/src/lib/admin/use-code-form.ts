// use-code-form —— state shared by CodeCreateForm / CodeCreateModal.
//
// As of A.3-IAM-5, a code only carries assumed_role_id; ACL / capability /
// skill prompts are all derived from the role. The three old fields
// permissions / grantedSkills / skillIDs have been removed entirely.

import { useCallback, useState } from 'react';

import type { CodeView, CreateCodeInput } from '@/lib/admin/use-codes';

export interface CodeFormState {
  code: string;
  label: string;
  purpose: string;
  suggested: string[];
  maxMembers: string;
  maxTurns: string;
  // maxBookings —— calendar.book quota per code; '' = nil (also meaningless
  // when the role hasn't unlocked calendar.book; kept as a string so it binds
  // directly to the input field).
  maxBookings: string;
  // assumedRoleID —— required; the UI defaults to pointing at the owner's public role.
  assumedRoleID: string;
  // promptID —— #104 per-code prompt; '' = not attached (persona is just the
  // role's). References the prompts library.
  promptID: string;
  // providerID —— which provider this code uses; '' = inherits the role, then falls back to the owner default.
  providerID: string;
}

const EMPTY: CodeFormState = {
  code: '', label: '', purpose: '',
  suggested: ['', ''],
  maxMembers: '', maxTurns: '', maxBookings: '',
  assumedRoleID: '', promptID: '', providerID: '',
};

export interface CodeFormHook {
  values: CodeFormState;
  setCode: (v: string) => void;
  setLabel: (v: string) => void;
  setPurpose: (v: string) => void;
  setMaxMembers: (v: string) => void;
  setMaxTurns: (v: string) => void;
  setMaxBookings: (v: string) => void;
  setAssumedRoleID: (v: string) => void;
  setPromptID: (v: string) => void;
  setProviderID: (v: string) => void;
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
  const setMaxMembers = useCallback(
    (maxMembers: string) => setValues((v) => ({ ...v, maxMembers })), [],
  );
  const setMaxTurns = useCallback(
    (maxTurns: string) => setValues((v) => ({ ...v, maxTurns })), [],
  );
  const setMaxBookings = useCallback(
    (maxBookings: string) => setValues((v) => ({ ...v, maxBookings })), [],
  );
  const setAssumedRoleID = useCallback(
    (assumedRoleID: string) => setValues((v) => ({ ...v, assumedRoleID })), [],
  );
  const setPromptID = useCallback(
    (promptID: string) => setValues((v) => ({ ...v, promptID })), [],
  );
  const setProviderID = useCallback(
    (providerID: string) => setValues((v) => ({ ...v, providerID })), [],
  );

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
    values, setCode, setLabel, setPurpose, setMaxMembers, setMaxTurns,
    setMaxBookings, setAssumedRoleID, setPromptID, setProviderID,
    updateQ, addQ, removeQ, reset, toInput,
  };
}

function seed(initial?: Partial<CodeView>): CodeFormState {
  return {
    code:    initial?.code ?? '',
    label:   initial?.label ?? '',
    purpose: initial?.purpose ?? '',
    suggested: initial?.ghosts?.length
      ? [...initial.ghosts]
      : ['', ''],
    maxMembers:   numOrEmpty(initial?.max_members),
    maxTurns:      numOrEmpty(initial?.max_turns_per_session),
    maxBookings:   numOrEmpty(initial?.max_bookings),
    assumedRoleID: initial?.assumed_role_id ?? '',
    promptID:      initial?.prompt_id ?? '',
    providerID:    initial?.provider_id ?? '',
  };
}

function numOrEmpty(n: number | null | undefined): string {
  return typeof n === 'number' && n > 0 ? String(n) : '';
}

function buildInput(v: CodeFormState): CreateCodeInput {
  return {
    code: v.code.trim(),
    label: v.label.trim(),
    purpose: v.purpose.trim(),
    ghosts: v.suggested.map((q) => q.trim()).filter(Boolean),
    max_members: parseQuota(v.maxMembers),
    max_turns_per_session: parseQuota(v.maxTurns),
    max_bookings: parseQuota(v.maxBookings),
    assumed_role_id: v.assumedRoleID === '' ? null : v.assumedRoleID,
    prompt_id: v.promptID === '' ? null : v.promptID,
    provider_id: v.providerID,
  };
}

function parseQuota(raw: string): number | null {
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
