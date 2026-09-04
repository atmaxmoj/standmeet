// page.tsx — the root route `/`.
//
// The homepage is a custom page now (A Slice 4/5): the middleware serves the live `home` page at
// `/` for a codeless visitor. This component runs when the middleware does NOT serve the homepage:
//   • unclaimed instance → server-redirect to /setup (so a fresh deploy lands on the setup form);
//   • a visitor arriving with ?code= (the middleware skips the homepage rewrite for them) → the
//     coded-visitor strategy (VisitorRoot): the built-in chat, or the code's attached custom page;
//   • claimed but no live home yet (the brief build window, or a failed build) → VisitorRoot with
//     no session falls through to a minimal identity page (HomeFallback).
// The old editable long-scroll (PageContent/PageShell) is gone; VisitorRoot restores only its
// coded-chat half.

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

export default async function Root() {
  const instance = await fetchInstance();
  // unclaimed → server redirect to /setup?t=TOKEN (redirect() throws, so nothing below runs).
  instance.claimed || redirect(`/setup?t=${instance.setup_token ?? ''}`);
  return <VisitorRoot name={instance.name} handle={instance.handle} />;
}
