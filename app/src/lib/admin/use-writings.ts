// use-writings —— /admin/writings 的状态。zustand store 管 list cache +
// status；action: create / update / publish / unpublish / delete。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';
import type { PendingFile } from '@/lib/writings/upload-asset';

export const AdminWritingViewSchema = z.object({
  id: z.string(), slug: z.string(), title: z.string(), excerpt: z.string(),
  body_md: z.string(), cover_headline: z.string(), cover_sub: z.string(),
  cover_hue: z.enum(['amber', 'violet', 'acid']),
  cover_image_asset_id: z.string().optional(),
  tags: z.array(z.string()), visibility: z.enum(['public', 'private']),
  cross_refs: z.array(z.string()), path: z.string(), read_minutes: z.number(),
  locked_body: z.string(), published: z.boolean(),
  published_at: z.string().optional(), created_at: z.string(), updated_at: z.string(),
  asset_urls: z.record(z.string(), z.string()).optional(),
});
export type AdminWritingView = z.infer<typeof AdminWritingViewSchema>;

// WritingSaveData —— multipart POST/PATCH 的 `data` JSON 字段。create 用
// publish + slug；edit 时 slug 是 URL，publish 不在这（走单独 endpoint）。
// cover_image_ref 可以是 pending-<id>（新上传，对应 files 里的一个）或
// 已存在 asset 的真 UUID（edit 时未改 cover）。
export interface WritingSaveData {
  slug?: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_image_ref: string;
  cover_headline: string;
  cover_sub: string;
  cover_hue: 'amber' | 'violet' | 'acid';
  visibility: 'public' | 'private';
  locked_body: string;
  tags: string[];
  cross_refs: string[];
  publish?: boolean;
}

// WritingSaveBundle —— 调 createWriting/updateWriting 时同时携带的数据 + 待上传 files。
export interface WritingSaveBundle {
  data: WritingSaveData;
  files: PendingFile[];
}

export interface WritingsHook {
  status: ResourceStatus;
  writings: readonly AdminWritingView[];
  error: string | null;
  refresh: () => Promise<void>;
  createWriting: (bundle: WritingSaveBundle) => Promise<boolean>;
  updateWriting: (id: string, bundle: WritingSaveBundle) => Promise<boolean>;
  deleteWriting: (id: string) => Promise<boolean>;
  publishWriting: (id: string) => Promise<boolean>;
  unpublishWriting: (id: string) => Promise<boolean>;
}

export const writingsStore = createResourceStore<AdminWritingView[]>({
  name: 'writings',
  fetcher: () => adminAPI.get('/writings/', z.array(AdminWritingViewSchema)),
});

export function useWritings(): WritingsHook {
  const r = readResource(writingsStore);
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

async function updateWriting(id: string, bundle: WritingSaveBundle): Promise<boolean> {
  try {
    const fd = buildWritingFormData(bundle);
    const updated = await adminAPI.patchForm(`/writings/${id}`, fd, AdminWritingViewSchema);
    writingsStore.getState().mutate((prev) =>
      (prev ?? []).map((w) => w.id === updated.id ? updated : w));
    return true;
  } catch {
    return false;
  }
}

async function createWriting(bundle: WritingSaveBundle): Promise<boolean> {
  try {
    const fd = buildWritingFormData(bundle);
    const created = await adminAPI.postForm('/writings/', fd, AdminWritingViewSchema);
    writingsStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
    return true;
  } catch {
    return false;
  }
}

function buildWritingFormData(bundle: WritingSaveBundle): FormData {
  const fd = new FormData();
  fd.append('data', JSON.stringify(bundle.data));
  for (const f of bundle.files) {
    fd.append('file:' + f.id, f.file, f.file.name);
  }
  return fd;
}

async function deleteWriting(id: string): Promise<boolean> {
  try {
    await adminAPI.deleteVoid(`/writings/${id}`);
    writingsStore.getState().mutate((prev) => (prev ?? []).filter((w) => w.id !== id));
    return true;
  } catch {
    return false;
  }
}

async function publishWriting(id: string): Promise<boolean> {
  return await flipPublish(id, true);
}

async function unpublishWriting(id: string): Promise<boolean> {
  return await flipPublish(id, false);
}

async function flipPublish(id: string, publish: boolean): Promise<boolean> {
  try {
    const path = publish ? `/writings/${id}/publish` : `/writings/${id}/unpublish`;
    const updated = await adminAPI.post(path, {}, AdminWritingViewSchema);
    writingsStore.getState().mutate((prev) =>
      (prev ?? []).map((w) => w.id === updated.id ? updated : w));
    return true;
  } catch {
    return false;
  }
}
