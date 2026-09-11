// microsites.ts —— the public microsites listing: GET /api/v1/microsites, so the
// index / gate / reader can discover and link the owner's published microsites by title
// without knowing a slug. Split out of public.ts to keep that file under its line cap.

import type { Metadata } from 'next';
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

// HomepageSEO —— the site root's SEO (owner-level, decoupled from the `home` microsite). Empty
// field = nothing set (no tag emitted).
export type HomepageSEO = { title: string; description: string; image: string };

const HomepageSEOSchema = z.object({
  title: z.string(),
  description: z.string(),
  image: z.string(),
});

const EMPTY_HOMEPAGE_SEO: HomepageSEO = { title: '', description: '', image: '' };

// fetchHomepageSEO —— the site root's SEO. Used by the root page's metadata (when no `home` build
// serves `/`) and by the homepage editor's SEO panel to load current values. Bad response / failure
// → empty, degrading the same way the microsites list does.
export async function fetchHomepageSEO(): Promise<HomepageSEO> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/homepage-seo`, { cache: 'no-store' });
    if (!res.ok) {
      return EMPTY_HOMEPAGE_SEO;
    }
    const parsed = HomepageSEOSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : EMPTY_HOMEPAGE_SEO;
  } catch {
    return EMPTY_HOMEPAGE_SEO;
  }
}

// homepageMetadata —— the site root's Next <head> from its SEO: the owner's title (falling back to
// the instance name), description, and Open Graph / Twitter card when an image is set. Built here so
// the root page component stays branch-free. Empty fields emit no tag.
export function homepageMetadata(seo: HomepageSEO, fallbackName: string): Metadata {
  const title = seo.title || fallbackName;
  const hasDesc = seo.description !== '';
  const hasImage = seo.image !== '';
  return {
    title,
    ...(hasDesc ? { description: seo.description } : {}),
    openGraph: {
      title,
      ...(hasDesc ? { description: seo.description } : {}),
      ...(hasImage ? { images: [seo.image] } : {}),
    },
    ...(hasImage ? { twitter: { card: 'summary_large_image' as const, images: [seo.image] } } : {}),
  };
}
