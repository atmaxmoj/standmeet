// custom-pages.ts —— the public custom-pages listing: GET /api/v1/custom-pages, so the
// index / gate / reader can discover and link the owner's published custom pages by title
// without knowing a slug. Split out of public.ts to keep that file under its line cap.

import { z } from 'zod';

import { baseURL } from '@/lib/api/public';

// CustomPageLink —— a published custom page for public discovery: slug + title, nothing more.
export type CustomPageLink = { slug: string; title: string };

const CustomPagesResponseSchema = z.object({
  pages: z.array(z.object({ slug: z.string(), title: z.string() })),
});

// fetchCustomPages —— the sole owner's published custom pages. Bad response / network
// failure → [], degrading the same way the tree fetches do.
export async function fetchCustomPages(): Promise<CustomPageLink[]> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/custom-pages`, { cache: 'no-store' });
    if (!res.ok) {
      return [];
    }
    const parsed = CustomPagesResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.pages : [];
  } catch {
    return [];
  }
}
