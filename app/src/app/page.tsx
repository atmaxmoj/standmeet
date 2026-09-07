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

import { TrackVisit } from '@/components/monitor/TrackVisit';

import { VisitorRoot } from '@/app/visitor-root';

export async function generateMetadata(): Promise<Metadata> {
  try {
    const instance = await fetchInstance();
    return { title: instance.name || 'StandMeet' };
  } catch {
    return { title: 'StandMeet' };
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
