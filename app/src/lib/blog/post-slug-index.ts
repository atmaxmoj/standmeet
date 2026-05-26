// post-slug-index —— blog editor 的 `[[crosslink]]` autocomplete 用的
// (slug, title) 索引。fetch owner 所有 post（含 draft），filter 由
// 调用方按 query 做。

export interface PostSlugEntry {
  slug: string;
  title: string;
}

interface AdminPostRow {
  slug: string;
  title: string;
}

const ENDPOINT = '/api/admin/posts/';

export async function fetchAdminPostSlugs(): Promise<PostSlugEntry[]> {
  const res = await fetch(ENDPOINT, { credentials: 'include' });
  if (!res.ok) throw new Error(`list admin posts: ${res.status}`);
  const rows = await res.json() as AdminPostRow[];
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
