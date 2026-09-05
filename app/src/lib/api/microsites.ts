// microsites.ts —— the public microsites listing: GET /api/v1/microsites, so the
// index / gate / reader can discover and link the owner's published microsites by title
// without knowing a slug. Split out of public.ts to keep that file under its line cap.

import { z } from 'zod';

import { baseURL } from '@/lib/api/public';

// MicrositeLink —— a published microsite for public discovery: slug + title, nothing more.
export type MicrositeLink = { slug: string; title: string };

const MicrositesResponseSchema = z.object({
  pages: z.array(z.object({ slug: z.string(), title: z.string() })),
});

// fetchMicrosites —— the sole owner's published microsites. Bad response / network
// failure → [], degrading the same way the tree fetches do.
export async function fetchMicrosites(): Promise<MicrositeLink[]> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/microsites`, { cache: 'no-store' });
    if (!res.ok) {
      return [];
    }
    const parsed = MicrositesResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.pages : [];
  } catch {
    return [];
  }
}
