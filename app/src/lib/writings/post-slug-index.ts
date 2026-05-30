// post-slug-index —— writings editor 的 `[[crosslink]]` autocomplete 用的
// (slug, title) 索引。fetch owner 所有 writing（含 draft），filter 由
// 调用方按 query 做。

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

export interface PostSlugEntry {
  slug: string;
  title: string;
}

const AdminPostRowSchema = z.array(z.object({ slug: z.string(), title: z.string() }));

const ENDPOINT = '/api/admin/writings/';

export async function fetchAdminPostSlugs(): Promise<PostSlugEntry[]> {
  const res = await fetch(ENDPOINT, { credentials: 'include' });
  if (!res.ok) throw new Error(`list admin writings: ${res.status}`);
  const rows = await safeJson(res, AdminPostRowSchema);
  return rows.map((r) => ({ slug: r.slug, title: r.title }));
}

export function filterSlugs(
  entries: readonly PostSlugEntry[], query: string,
): PostSlugEntry[] {
  const q = query.toLowerCase();
  const match = q === ''
    ? entries.slice()
    : entries.filter((e) => entryMatches(e, q));
  return match.slice(0, 12);
}

function entryMatches(entry: PostSlugEntry, q: string): boolean {
  return entry.slug.toLowerCase().includes(q)
    || entry.title.toLowerCase().includes(q);
}
