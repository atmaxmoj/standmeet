// use-writings —— state for /admin/writings. A zustand store manages list cache +
// status; actions: create / update / publish / unpublish / delete.

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { bumpCorpusEpoch } from '@/lib/admin/corpus-tree-epoch';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';
import type { PendingFile } from '@/lib/writings/upload-asset';

export const AdminWritingViewSchema = z.object({
  id: z.string(), slug: z.string(), title: z.string(), excerpt: z.string(),
  body_md: z.string(),
  // preview —— backend LeadLine: a CLEAN lead the card shows when excerpt is empty, so the card
  // never renders a raw substring of body_md (F-R-1 class).
  preview: z.string().optional().default(''),
  cover_headline: z.string(),
  cover_hue: z.enum(['amber', 'violet', 'acid']),
  cover_image_asset_id: z.string().optional(),
  tags: z.array(z.string()), visibility: z.enum(['public', 'private']),
  cross_refs: z.array(z.string()), path: z.string(), read_minutes: z.number(),
  locked_body: z.string(), published: z.boolean(),
  parent_id: z.string().optional(),
  published_at: z.string().optional(), created_at: z.string(), updated_at: z.string(),
  asset_urls: z.record(z.string(), z.string()).optional(),
  has_children: z.boolean().optional(),
});
export type AdminWritingView = z.infer<typeof AdminWritingViewSchema>;

// loadWritingTreeChildren —— one lazy layer of the writings tree (empty parent = roots).
export function loadWritingTreeChildren(parentID: string): Promise<AdminWritingView[]> {
  const qs = parentID ? `?parent=${encodeURIComponent(parentID)}` : '';
  return adminAPI.get(`/writings/tree${qs}`, z.array(AdminWritingViewSchema));
}

// WritingSaveData —— the `data` JSON field of the multipart POST/PATCH.
// create uses publish + slug; on edit slug is the URL, and publish isn't
// here (it goes through a separate endpoint). cover_image_ref can be
// pending-<id> (a new upload, matching one entry in files) or the real UUID
// of an existing asset (cover unchanged during edit).
export interface WritingSaveData {
  slug?: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_image_ref: string;
  cover_headline: string;
  cover_hue: 'amber' | 'violet' | 'acid';
  visibility: 'public' | 'private';
  locked_body: string;
  parent_id?: string;
  tags: string[];
  cross_refs: string[];
  publish?: boolean;
}

// WritingSaveBundle —— the data + pending-upload files carried together when calling createWriting/updateWriting.
export interface WritingSaveBundle {
  data: WritingSaveData;
  files: PendingFile[];
}

export interface WritingsHook {
  status: ResourceStatus;
  writings: readonly AdminWritingView[];
  error: string | null;
  refresh: () => Promise<void>;
  createWriting: (bundle: WritingSaveBundle) => Promise<void>;
  updateWriting: (id: string, bundle: WritingSaveBundle) => Promise<void>;
  deleteWriting: (id: string) => Promise<void>;
  publishWriting: (id: string) => Promise<void>;
  unpublishWriting: (id: string) => Promise<void>;
}

export const writingsStore = createResourceStore<AdminWritingView[]>({
  name: 'writings',
  fetcher: () => adminAPI.get('/writings/', z.array(AdminWritingViewSchema)),
});

export function useWritings(): WritingsHook {
  const r = useResource(writingsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    writings: r.data ?? [],
    error: r.error,
    refresh: writingsStore.getState().refresh,
    createWriting,
    updateWriting,
    deleteWriting,
    publishWriting,
    unpublishWriting,
  };
}

// The mutation throws (no longer swallowed into false): the caller finishes
// up with useAction (one-click actions), or inline try/catch (forms: stay open on failure).
async function updateWriting(id: string, bundle: WritingSaveBundle): Promise<void> {
  const fd = buildWritingFormData(bundle);
  const updated = await adminAPI.patchForm(`/writings/${id}`, fd, AdminWritingViewSchema);
  writingsStore.getState().mutate((prev) =>
    (prev ?? []).map((w) => w.id === updated.id ? updated : w));
  bumpCorpusEpoch();
}

// createWriting —— once created, the **tree** must be invalidated too, not
// just the flat list. Each level of the tree is cached by corpus epoch
// (useAdminTreeLayer). Mutating only the flat store means: the count says
// "2 writings", but the tree is still on its old layer — the parent node
// doesn't know it gained a child, **it doesn't even grow an expand arrow**,
// so what the owner just created simply vanishes on screen. Count says 2,
// list shows 1 — exactly the class of bug the owner already flagged (F-D-1:
// the codes list said "No codes yet" while the KPI counted 3).
async function createWriting(bundle: WritingSaveBundle): Promise<void> {
  const fd = buildWritingFormData(bundle);
  const created = await adminAPI.postForm('/writings/', fd, AdminWritingViewSchema);
  writingsStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
  bumpCorpusEpoch();
}

function buildWritingFormData(bundle: WritingSaveBundle): FormData {
  const fd = new FormData();
  fd.append('data', JSON.stringify(bundle.data));
  for (const f of bundle.files) {
    fd.append('file:' + f.id, f.file, f.file.name);
  }
  return fd;
}

async function deleteWriting(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/writings/${id}`);
  writingsStore.getState().mutate((prev) => (prev ?? []).filter((w) => w.id !== id));
  bumpCorpusEpoch();
}

async function publishWriting(id: string): Promise<void> {
  await flipPublish(id, true);
  bumpCorpusEpoch();
}

async function unpublishWriting(id: string): Promise<void> {
  await flipPublish(id, false);
  bumpCorpusEpoch();
}

async function flipPublish(id: string, publish: boolean): Promise<void> {
  const path = publish ? `/writings/${id}/publish` : `/writings/${id}/unpublish`;
  const updated = await adminAPI.post(path, {}, AdminWritingViewSchema);
  writingsStore.getState().mutate((prev) =>
    (prev ?? []).map((w) => w.id === updated.id ? updated : w));
}
