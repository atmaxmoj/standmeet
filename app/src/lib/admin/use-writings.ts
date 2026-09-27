// use-writings —— state for /admin/writings: the paged list, the header counts, and the actions
// create / update / publish / unpublish / delete.

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { fetchListTotal } from '@/lib/api/list-total';
import { bumpCorpusEpoch } from '@/lib/admin/corpus-tree-epoch';
import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
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

// WritingCounts —— the header's "N writings · M drafts", from the server's totals.
export interface WritingCounts { published: number; drafts: number }

export interface WritingsHook {
  page: PagedState<AdminWritingView>;
  counts: WritingCounts | undefined;
  refresh: () => Promise<void>;
  createWriting: (bundle: WritingSaveBundle) => Promise<void>;
  updateWriting: (id: string, bundle: WritingSaveBundle) => Promise<void>;
  deleteWriting: (id: string) => Promise<void>;
  publishWriting: (id: string) => Promise<void>;
  unpublishWriting: (id: string) => Promise<void>;
}

// writingsPage —— writings.list, one page at a time (docs/design/paging.md): the grid, the list
// view and the header all read it. It used to read every page into the browser.
export const writingsPage = createPagedStore({
  name: 'writings', path: '/writings/', item: AdminWritingViewSchema,
});

const writingCountsStore = createResourceStore<WritingCounts>({
  name: 'writing-counts',
  fetcher: async () => {
    const [published, drafts] = await Promise.all([
      fetchListTotal('/api/admin/writings/?state=published'),
      fetchListTotal('/api/admin/writings/?state=draft'),
    ]);
    return { published, drafts };
  },
});

// refreshWritings —— after a writing was added or removed (or an import landed): the page and the
// counts both re-read. Where a row now sits is the server's to say.
async function refreshWritings(): Promise<void> {
  await Promise.all([writingsPage.getState().reload(), writingCountsStore.getState().refresh()]);
}

export function useWritings(): WritingsHook {
  const page = usePaged(writingsPage);
  const counts = useResource(writingCountsStore);
  return {
    page,
    counts: counts.data,
    refresh: refreshWritings,
    createWriting,
    updateWriting,
    deleteWriting,
    publishWriting,
    unpublishWriting,
  };
}

// The mutation throws (no longer swallowed into false): the caller finishes
// up with useAction (one-click actions), or inline try/catch (forms: stay open on failure).
// An edit replaces the row in place, so editing a writing on page 3 does not jump to page 1.
async function updateWriting(id: string, bundle: WritingSaveBundle): Promise<void> {
  const fd = buildWritingFormData(bundle);
  const updated = await adminAPI.patchForm(`/writings/${id}`, fd, AdminWritingViewSchema);
  writingsPage.getState().patch(updated.id, () => updated);
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
  await adminAPI.postForm('/writings/', fd, AdminWritingViewSchema);
  await refreshWritings();
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
  await refreshWritings();
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
  writingsPage.getState().patch(updated.id, () => updated);
  await writingCountsStore.getState().refresh();
}
