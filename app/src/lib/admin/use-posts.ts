// use-posts —— /admin/posts 的状态。zustand store 管 list cache + status；
// action: create / update / publish / unpublish / delete。

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';
import type { PendingFile } from '@/lib/blog/upload-asset';

export interface AdminPostView {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  cover_headline: string;
  cover_sub: string;
  cover_hue: 'amber' | 'violet' | 'acid';
  cover_image_asset_id?: string;
  tags: string[];
  visibility: 'public' | 'private';
  cross_refs: string[];
  path: string;
  read_minutes: number;
  locked_body: string;
  published: boolean;
  published_at?: string;
  created_at: string;
  updated_at: string;
  asset_urls?: Record<string, string>;
}

// PostSaveData —— multipart POST/PATCH 的 `data` JSON 字段。create 用
// publish + slug；edit 时 slug 是 URL，publish 不在这（走单独 endpoint）。
// cover_image_ref 可以是 pending-<id>（新上传，对应 files 里的一个）或
// 已存在 asset 的真 UUID（edit 时未改 cover）。
export interface PostSaveData {
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

// PostSaveBundle —— 调 createPost/updatePost 时同时携带的数据 + 待上传 files。
export interface PostSaveBundle {
  data: PostSaveData;
  files: PendingFile[];
}

export interface PostsHook {
  status: ResourceStatus;
  posts: readonly AdminPostView[];
  error: string | null;
  refresh: () => Promise<void>;
  createPost: (bundle: PostSaveBundle) => Promise<boolean>;
  updatePost: (id: string, bundle: PostSaveBundle) => Promise<boolean>;
  deletePost: (id: string) => Promise<boolean>;
  publishPost: (id: string) => Promise<boolean>;
  unpublishPost: (id: string) => Promise<boolean>;
}

export const postsStore = createResourceStore<AdminPostView[]>({
  name: 'posts',
  fetcher: () => adminAPI.get<AdminPostView[]>('/posts/'),
});

export function usePosts(): PostsHook {
  const r = readResource(postsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    posts: r.data ?? [],
    error: r.error,
    refresh: postsStore.getState().refresh,
    createPost,
    updatePost,
    deletePost,
    publishPost,
    unpublishPost,
  };
}

async function updatePost(id: string, bundle: PostSaveBundle): Promise<boolean> {
  try {
    const fd = buildPostFormData(bundle);
    const updated = await adminAPI.patchForm<AdminPostView>(`/posts/${id}`, fd);
    postsStore.getState().mutate((prev) =>
      (prev ?? []).map((p) => p.id === updated.id ? updated : p));
    return true;
  } catch {
    return false;
  }
}

async function createPost(bundle: PostSaveBundle): Promise<boolean> {
  try {
    const fd = buildPostFormData(bundle);
    const created = await adminAPI.postForm<AdminPostView>('/posts/', fd);
    postsStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
    return true;
  } catch {
    return false;
  }
}

function buildPostFormData(bundle: PostSaveBundle): FormData {
  const fd = new FormData();
  fd.append('data', JSON.stringify(bundle.data));
  for (const f of bundle.files) {
    fd.append('file:' + f.id, f.file, f.file.name);
  }
  return fd;
}

async function deletePost(id: string): Promise<boolean> {
  try {
    await adminAPI.delete<unknown>(`/posts/${id}`);
    postsStore.getState().mutate((prev) => (prev ?? []).filter((p) => p.id !== id));
    return true;
  } catch {
    return false;
  }
}

async function publishPost(id: string): Promise<boolean> {
  return await flipPublish(id, true);
}

async function unpublishPost(id: string): Promise<boolean> {
  return await flipPublish(id, false);
}

async function flipPublish(id: string, publish: boolean): Promise<boolean> {
  try {
    const path = publish ? `/posts/${id}/publish` : `/posts/${id}/unpublish`;
    const updated = await adminAPI.post<AdminPostView>(path, {});
    postsStore.getState().mutate((prev) =>
      (prev ?? []).map((p) => p.id === updated.id ? updated : p));
    return true;
  } catch {
    return false;
  }
}
