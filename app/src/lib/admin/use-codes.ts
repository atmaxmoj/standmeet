import { z } from 'zod';
// use-codes —— state for /admin/codes. A zustand store manages list cache +
// status; action functions (create / revoke / updateQuotas / dispatchSave)
// sit alongside the store, mutating/refreshing directly once called.
//
// This is the zustand refactor's template: other hooks follow this same pattern.

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// PathPermission —— the access unit of the retrieval-redesign. first-match-wins
// as of A.3-IAM-5: PathPermission / corpus_permissions / granted_skills /
// skill_ids have all been removed from the code wire shape — a code only
// carries assumed_role_id, and ACL / capability are both derived from the role.
export const CodeViewSchema = z.object({
  id: z.string(), code: z.string(), label: z.string(), status: z.string(),
  purpose: z.string().optional(),
  // A slice column can serialize as JSON `null` (F-D-1); `.optional()` alone rejects null and
  // would throw the whole z.array(...) parse, blanking the list. Accept null on the wire but
  // map it away so the output type stays `string[] | undefined`. Backend now emits [] too
  // (DecodeStringJSON) — this is defense-in-depth so one bad row never hides the rest.
  ghosts: z.array(z.string()).nullish().transform((v) => v ?? undefined),
  expires_at: z.string().optional(),
  max_members: z.number().nullable().optional(),
  max_turns_per_session: z.number().nullable().optional(),
  max_bookings: z.number().nullable().optional(),
  // require_ghost_evidence —— F-A-10 per-code override: null/absent = inherits the role; true/false = explicit override.
  require_ghost_evidence: z.boolean().nullable().optional(),
  assumed_role_id: z.string(),
  prompt_id: z.string().nullable().optional(),
  // provider_id —— the provider this code specifies; '' = inherits the role, then falls back to the owner default.
  provider_id: z.string().nullish().transform((v) => v ?? ''),
  // member_count —— how many people have joined so far. The cap on its own
  // says nothing: a full code and a brand-new code would look identical,
  // while visitors are already being turned away at the door (F-D-2). Old
  // backends don't send this field, so nullish→0.
  member_count: z.number().nullish().transform((v) => v ?? 0),
  // microsite_slug —— which page this code opens. '' = opens the default visitor chat.
  // nullish: old backends don't send this field, and a missing field
  // shouldn't silently fail the whole code list ([[zod-unknown-is-not-optional]]).
  microsite_slug: z.string().nullish().transform((v) => v ?? ''),
});
export type CodeView = z.infer<typeof CodeViewSchema>;

export interface CreateCodeInput {
  code: string;
  label: string;
  purpose?: string;
  ghosts?: string[];
  max_members?: number | null;
  max_turns_per_session?: number | null;
  max_bookings?: number | null;
  assumed_role_id?: string | null;
  prompt_id?: string | null;
  provider_id?: string;
}

export interface QuotasInput {
  max_members: number | null;
  max_turns_per_session: number | null;
}

export interface CodesHook {
  status: ResourceStatus;
  codes: readonly CodeView[];
  error: string | null;
  refresh: () => Promise<void>;
  createCode: (input: CreateCodeInput) => Promise<void>;
  revokeCode: (id: string) => Promise<void>;
  updateQuotas: (id: string, input: QuotasInput) => Promise<void>;
  setGhostEvidence: (id: string, value: boolean | null) => Promise<void>;
  setMicrosite: (id: string, slug: string) => Promise<void>;
}

// codesStore —— a module singleton; fetched once, shared by every component.
export const codesStore = createResourceStore<CodeView[]>({
  name: 'codes',
  fetcher: () => adminAPI.get('/codes/', z.array(CodeViewSchema)),
});

// useCodes —— the component-facing hook. Reads the store + calls ensureLoaded on mount.
export function useCodes(): CodesHook {
  const r = useResource(codesStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    codes: r.data ?? [],
    error: r.error,
    refresh: codesStore.getState().refresh,
    createCode,
    revokeCode,
    updateQuotas,
    setGhostEvidence,
    setMicrosite,
  };
}

// The mutation throws (no longer swallowed into false): the caller finishes
// up with useAction (success toast / failure report), or inlines it in place.
async function createCode(input: CreateCodeInput): Promise<void> {
  const created = await adminAPI.post('/codes/', toCreateBody(input), CodeViewSchema);
  codesStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
}

async function revokeCode(id: string): Promise<void> {
  await adminAPI.postVoid(`/codes/${id}/revoke`, {});
  codesStore.getState().mutate((prev) =>
    (prev ?? []).map((c) => c.id === id ? { ...c, status: 'revoked' } : c));
}

async function updateQuotas(id: string, input: QuotasInput): Promise<void> {
  const updated = await adminAPI.patch(`/codes/${id}/quotas`, input, CodeViewSchema);
  codesStore.getState().mutate((prev) =>
    (prev ?? []).map((c) => c.id === updated.id ? updated : c));
}

// setGhostEvidence —— F-A-10 per-code override: null = inherits the role; true/false = explicit override (code takes priority over role).
async function setGhostEvidence(id: string, value: boolean | null): Promise<void> {
  const updated = await adminAPI.patch(
    `/codes/${id}/ghost-evidence`, { require_ghost_evidence: value }, CodeViewSchema,
  );
  codesStore.getState().mutate((prev) =>
    (prev ?? []).map((c) => c.id === updated.id ? updated : c));
}

// setMicrosite —— which page this code opens. Empty string = unbind, back to the default visitor chat.
// A code attaches to at most one page — so this is an **assignment**, not
// "add one": switching pages replaces the previous one.
// The receipt returns the **slug as read back**, not an echo of the input —
// so what's stored into the store is the receipt's value, not the one just selected ([[write-with-no-receipt]]).
async function setMicrosite(id: string, slug: string): Promise<void> {
  const done = await adminAPI.patch(
    `/codes/${id}/microsite`, { slug },
    z.object({ code_id: z.string(), microsite_slug: z.string() }),
  );
  codesStore.getState().mutate((prev) => (prev ?? []).map(
    (c) => c.id === done.code_id ? { ...c, microsite_slug: done.microsite_slug } : c));
}

function toCreateBody(input: CreateCodeInput): Record<string, unknown> {
  return {
    code: input.code,
    label: input.label,
    purpose: input.purpose ?? '',
    ghosts: input.ghosts ?? [],
    max_members: input.max_members ?? null,
    max_turns_per_session: input.max_turns_per_session ?? null,
    max_bookings: input.max_bookings ?? null,
    assumed_role_id: input.assumed_role_id ?? null,
    prompt_id: input.prompt_id ?? null,
    // Empty string = unspecified (the backend treats empty as "not given").
    // null isn't sent here: that column is a uuid reference, and the backend expects the id as a string.
    provider_id: input.provider_id ?? '',
  };
}

// codeModalLabels —— the modal's header copy / kicker / whether it's an
// edit. The switch-by-existing branching is moved to lib as if/else, keeping the component's cyclo ≤ 3.
export function codeModalLabels(
  existing: CodeView | null,
): { editing: boolean; kicker: string; title: string } {
  if (existing) {
    return { editing: true, kicker: 'edit code', title: existing.label };
  }
  return { editing: false, kicker: 'new code', title: 'gate a slice of your wiki' };
}

// dispatchSave —— the "save" logic: editing decides whether this goes
// through PATCH /quotas or POST. Branching moved to lib so the component's complexity stays ≤ 3.
export async function dispatchSave(
  existing: CodeView | null,
  input: CreateCodeInput,
  onCreate: (input: CreateCodeInput) => Promise<void>,
  onUpdateQuotas: (id: string, input: QuotasInput) => Promise<void>,
): Promise<void> {
  if (existing === null) {
    await onCreate(input);
    return;
  }
  await onUpdateQuotas(existing.id, {
    max_members: input.max_members ?? null,
    max_turns_per_session: input.max_turns_per_session ?? null,
  });
}

// MemberView / listCodeMembers —— a member is a read-only child entity of
// the AccessCode aggregate. revoke happens at the code level (revokeCode) — a member should never be managed individually.
const MemberViewSchema = z.object({
  id: z.string(), display_name: z.string(), email: z.string().optional(),
  is_anonymous: z.boolean(), last_seen_at: z.string().optional(),
});
export type MemberView = z.infer<typeof MemberViewSchema>;

export async function listCodeMembers(codeID: string): Promise<MemberView[]> {
  return await adminAPI.get(`/codes/${codeID}/members`, z.array(MemberViewSchema));
}
