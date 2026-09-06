// c/[slug]/page.tsx — the coded-conversation landing route `/c/<slug>`.
//
// After a visitor redeems a code, the URL is rewritten to `/c/<slug>` (see code-landing.ts): the raw
// `?code=` leaves the address bar and the chat gets a stable path. This route serves a reload or a
// re-share of that path. The slug is a LOCATOR, not a credential: it carries no code, so authorization
// still comes only from the stored session. A visitor who opens `/c/<slug>` with no session sees the
// identity fallback (HomeFallback) — no chat, no access — exactly as bare `/` does for a stranger.
//
// hasCode is false here: there is no `?code=` on this path to absorb, so nothing forces the picker.
// A returning visitor with a stored session lands straight in ChatRoom; everyone else falls through.

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { fetchInstance } from '@/lib/api/instance';

import { VisitorRoot } from '@/app/visitor-root';

export async function generateMetadata(): Promise<Metadata> {
  try {
    const instance = await fetchInstance();
    return { title: instance.name || 'StandMeet' };
  } catch {
    return { title: 'StandMeet' };
  }
}

export default async function CodedLanding() {
  const instance = await fetchInstance();
  // unclaimed → server redirect to /setup?t=TOKEN (redirect() throws, so nothing below runs).
  instance.claimed || redirect(`/setup?t=${instance.setup_token ?? ''}`);
  return <VisitorRoot name={instance.name} handle={instance.handle} hasCode={false} />;
}
