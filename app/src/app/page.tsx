// page.tsx — the root route `/`.
//
// The homepage is a microsite now (A Slice 4/5): the middleware serves the live `home` page at
// `/` for a codeless visitor. This component runs when the middleware does NOT serve the homepage:
//   • unclaimed instance → server-redirect to /setup (so a fresh deploy lands on the setup form);
//   • a visitor arriving with ?code= (the middleware skips the homepage rewrite for them) → the
//     coded-visitor strategy (VisitorRoot): the built-in chat, or the code's attached microsite;
//   • claimed but no live home yet (the brief build window, or a failed build) → VisitorRoot with
//     no session falls through to a minimal identity page (HomeFallback).
// The old editable long-scroll (PageContent/PageShell) is gone; VisitorRoot restores only its
// coded-chat half.

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { fetchInstance } from '@/lib/api/instance';
import { fetchHomepageSEO, homepageMetadata } from '@/lib/api/microsites';

import { TrackVisit } from '@/components/monitor/TrackVisit';

import { VisitorRoot } from '@/app/visitor-root';

// generateMetadata —— the site root's <head> when THIS component serves `/` (no live `home` build;
// when one is live the middleware rewrites to the backend, which injects the same SEO there). The
// owner's site-root SEO wins over the instance name; it is owner-level, so it holds whether or not a
// `home` page is materialized. The Metadata is assembled in lib (homepageMetadata) so this stays flat.
export async function generateMetadata(): Promise<Metadata> {
  const seo = await fetchHomepageSEO();
  return homepageMetadata(seo, await instanceName());
}

// instanceName —— the instance's name for the title fallback (used when the owner set no homepage
// SEO title). Degrades to "StandMeet" if the instance can't be read.
async function instanceName(): Promise<string> {
  try {
    return (await fetchInstance()).name || 'StandMeet';
  } catch {
    return 'StandMeet';
  }
}

type SearchParams = Record<string, string | string[] | undefined>;

// hasCodeParam — is there a non-empty ?code= in the URL. Read on the SERVER so VisitorRoot knows from
// its first paint that this is a coded visitor and never flashes HomeFallback while the client absorbs.
function hasCodeParam(sp: SearchParams): boolean {
  const c = sp['code'];
  return typeof c === 'string' && c !== '';
}

export default async function Root({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const instance = await fetchInstance();
  // unclaimed → server redirect to /setup?t=TOKEN (redirect() throws, so nothing below runs).
  instance.claimed || redirect(`/setup?t=${instance.setup_token ?? ''}`);
  const hasCode = hasCodeParam(await searchParams);
  return (
    <>
      {/* The only signal this surface has. The backend's `/homepage` route is a liveness probe
          the middleware fires on every request to `/`, person or not, so it cannot be counted
          (see monitor/mw/routes.go). */}
      <TrackVisit surface="index" scroll />
      <VisitorRoot name={instance.name} handle={instance.handle} hasCode={hasCode} />
    </>
  );
}
