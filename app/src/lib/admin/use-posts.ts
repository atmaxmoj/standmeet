// use-posts —— /admin/posts 的状态。zustand store 管 list cache + status；
// action: create / update / publish / unpublish / delete。

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';
import type { PostBlock } from '@/lib/api/public';

export interface AdminPostView {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: PostBlock[];
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
}

export interface CreatePostInput {
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
  locked_body: string;
  publish: boolean;
}

export interface PostsHook {
  status: ResourceStatus;
  posts: readonly AdminPostView[];
  error: string | null;
  refresh: () => Promise<void>;
  createPost: (input: CreatePostInput) => Promise<boolean>;
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
    deletePost,
    publishPost,
    unpublishPost,
  };
}

async function createPost(input: CreatePostInput): Promise<boolean> {
  try {
    const created = await adminAPI.post<AdminPostView>('/posts/', input);
    postsStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
    return true;
  } catch {
    return false;
  }
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
