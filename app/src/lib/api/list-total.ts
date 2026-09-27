// list-total —— how many rows a paged admin list holds, from the server (docs/design/paging.md).
// A count is never the length of a fetched page: past one page that undercounts (F-L-4). Asks for
// a one-row page and reads its `total`.

import { z } from 'zod';

const TotalSchema = z.object({ total: z.number() });

// fetchListTotal —— `path` is the list's /api/admin/... URL with its filters (e.g. ?status=open).
export async function fetchListTotal(path: string): Promise<number> {
  const url = `${path}${path.includes('?') ? '&' : '?'}limit=1`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return TotalSchema.parse(await res.json()).total;
}
