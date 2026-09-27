import { z } from 'zod';
// use-codes —— state for /admin/codes. A zustand store manages list cache +
// status; action functions (create / revoke / updateQuotas / dispatchSave)
// sit alongside the store, mutating/refreshing directly once called.
//
// This is the zustand refactor's template: other hooks follow this same pattern.

import { useState } from 'react';

import { adminAPI } from '@/lib/api/admin';
import type { CodeFilter } from '@/lib/admin/code-filter';
import {
  createPagedStore, usePaged, type PageParams, type PagedState, type PagedStore,
} from '@/lib/state/create-paged-store';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// PathPermission —— the access unit of the retrieval-redesign. first-match-wins
// as of A.3-IAM-5: PathPermission / corpus_permissions / granted_skills /
// skill_ids have all been removed from the code wire shape — a code only
// carries assumed_role_id, and ACL / block are both derived from the role.
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
  // bundle —— which bundle of blocks this code carries. '' = none, and the code is
  // judged by its role, which is every code issued before bundles existed. nullish
  // rather than required: an older backend simply does not send the field, and one
  // missing key must not blank the entire codes screen.
  bundle: z.string().nullish().transform((v) => v ?? ''),
  // role_name —— the assumed role's name, joined on list rows; '' on a write receipt.
  role_name: z.string().nullish().transform((v) => v ?? ''),
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
  // bundle —— the blocks this code carries, by bundle name. Omit for none.
  bundle?: string;
}

export interface QuotasInput {
  max_members: number | null;
  max_turns_per_session: number | null;
}

export type CodeCounts = Record<CodeFilter, number>;

export interface CodesHook {
  status: ResourceStatus;
  codes: readonly CodeView[];
  counts: CodeCounts | undefined;
  error: string | null;
  page: PagedState<CodeView>;
  createCode: (input: CreateCodeInput) => Promise<void>;
  revokeCode: (id: string) => Promise<void>;
  rotateCode: (id: string, newCode: string) => Promise<void>;
  updateQuotas: (id: string, input: QuotasInput) => Promise<void>;
  setGhostEvidence: (id: string, value: boolean | null) => Promise<void>;
  setMicrosite: (id: string, slug: string) => Promise<void>;
  setBundle: (id: string, bundle: string) => Promise<void>;
}

// codesPage —— the codes section's list: one page at a time, filtered and searched on the
// server (docs/design/paging.md). Opens on active codes.
export const codesPage = createPagedStore({
  name: 'codes', path: '/codes/', item: CodeViewSchema, params: { state: 'active', q: '' },
});

// codeCountsStore —— the count behind each filter chip, counted in SQL, never from a loaded page.
export const codeCountsStore = createResourceStore<CodeCounts>({
  name: 'code-counts',
  fetcher: () => adminAPI.get('/codes/counts', z.object({
    active: z.number(), revoked: z.number(), expired: z.number(), all: z.number(),
  })),
});

// useCodes —— the codes section's hook: the paged list, the counts, the mutations.
export function useCodes(): CodesHook {
  const page = usePaged(codesPage);
  const counts = useResource(codeCountsStore);
  return {
    status: page.status,
    codes: page.items,
    counts: counts.data,
    error: page.error,
    page,
    ...CODE_MUTATIONS,
  };
}

export interface CodePicker {
  page: PagedState<CodeView>;
  query: string;
  setQuery: (q: string) => void;
}

// useCodePicker —— a picker's own view of active codes: the newest page, narrowed on the server
// as the owner types. Its own store, so typing in a picker never filters the codes section.
// extra —— more server-side filters, fixed for this picker (the embed picker's {embed: 'none'}).
export function useCodePicker(extra: PageParams = {}): CodePicker {
  const [store] = useState<PagedStore<CodeView>>(() => createPagedStore({
    name: 'code-picker', path: '/codes/', item: CodeViewSchema,
    params: { state: 'active', q: '', ...extra },
  }));
  const page = usePaged(store);
  return { page, query: page.params.q ?? '', setQuery: (q) => page.setParams({ q }) };
}

// CODE_MUTATIONS —— for a component that edits a code but does not show the list.
export const CODE_MUTATIONS = {
  createCode, revokeCode, rotateCode, updateQuotas, setGhostEvidence, setMicrosite, setBundle,
};

// afterMembershipChange —— a create or revoke moves a code between filters: reload the page
// and the counts rather than guess where it now belongs.
async function afterMembershipChange(): Promise<void> {
  await Promise.all([codesPage.getState().reload(), codeCountsStore.getState().refresh()]);
}

function replaceCode(updated: CodeView): void {
  codesPage.getState().patch(updated.id, () => updated);
}

// The mutation throws (no longer swallowed into false): the caller finishes
// up with useAction (success toast / failure report), or inlines it in place.
async function createCode(input: CreateCodeInput): Promise<void> {
  await adminAPI.post('/codes/', toCreateBody(input), CodeViewSchema);
  await afterMembershipChange();
}

async function revokeCode(id: string): Promise<void> {
  await adminAPI.postVoid(`/codes/${id}/revoke`, {});
  await afterMembershipChange();
}

// rotateCode —— change a code's STRING (leak recovery). The id is unchanged, so id-keyed links (embeds,
// applications) survive; only the old literal string dies. The warning modal in the UI states this.
async function rotateCode(id: string, newCode: string): Promise<void> {
  replaceCode(await adminAPI.patch(`/codes/${id}/code`, { code: newCode }, CodeViewSchema));
}

async function updateQuotas(id: string, input: QuotasInput): Promise<void> {
  replaceCode(await adminAPI.patch(`/codes/${id}/quotas`, input, CodeViewSchema));
}

// setGhostEvidence —— F-A-10 per-code override: null = inherits the role; true/false = explicit override (code takes priority over role).
async function setGhostEvidence(id: string, value: boolean | null): Promise<void> {
  replaceCode(await adminAPI.patch(
    `/codes/${id}/ghost-evidence`, { require_ghost_evidence: value }, CodeViewSchema,
  ));
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
  codesPage.getState().patch(done.code_id, (c) => ({ ...c, microsite_slug: done.microsite_slug }));
}

// setBundle —— bind an EXISTING code to a group of blocks, switch it, or clear it. Empty = unbind,
// back to the role's grant. The create path binds a bundle at issue time; this is the after-the-fact
// rebind, so a group assembled later can reach a live code without revoking it.
// Read-back receipt: what lands in the store is the bundle name the server returns ([[write-with-no-receipt]]).
async function setBundle(id: string, bundle: string): Promise<void> {
  const done = await adminAPI.patch(
    `/codes/${id}/bundle`, { bundle },
    z.object({ code_id: z.string(), bundle: z.string() }),
  );
  codesPage.getState().patch(done.code_id, (c) => ({ ...c, bundle: done.bundle }));
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
    // bundle —— which blocks this code carries. Empty = none, and the code is judged by
    // its role. This function names every field it sends, so a field added to
    // CreateCodeInput and not added here is silently dropped: the owner picks a bundle,
    // the code is issued, and it carries nothing. That happened.
    bundle: input.bundle ?? '',
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

// MemberView —— a member is a read-only child entity of the AccessCode aggregate. revoke happens
// at the code level (revokeCode) — a member should never be managed individually.
export const MemberViewSchema = z.object({
  id: z.string(), display_name: z.string(), email: z.string().optional(),
  is_anonymous: z.boolean(), last_seen_at: z.string().optional(),
});
export type MemberView = z.infer<typeof MemberViewSchema>;
