// page.tsx — the root public page: SSR fetches `/api/v1/page` (sole owner, v1 single-owner
// instance). Renders the five sections — hero / insights / projects / where / contact — as
// a long scroll, with a sticky ChatDock at the bottom so visitors can ask questions.
//
// Pre-claim (nobody has claimed the instance yet), `/api/v1/instance` returns a setup_token,
// so this does a server-side redirect to /setup?t=<token> — the operator of a fresh deploy
// doesn't have to copy the stdout banner; opening the domain's / auto-lands on the setup form.

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

import { fetchInstance } from '@/lib/api/instance';
import { fetchPublicPage } from '@/lib/api/public';

import { PageShell } from '@/app/page-shell';

// generateMetadata — og:description / meta description read the **real** hero_prose (rot-C3).
// The root page used to have no generateMetadata, so it inherited the hardcoded string
// 'A personal page that argues back.' from layout.tsx — nothing the owner changed ever showed
// up, while the SEO UI still told the owner to edit a "page tagline" that didn't exist. Now
// the share preview follows the owner's hero prose. unclaimed / fetch fails → fall back to a
// neutral default (no crash).
export async function generateMetadata(): Promise<Metadata> {
  try {
    const { owner, content } = await fetchPublicPage();
    const description = content.hero_prose.slice(0, 160);
    return {
      title: owner.full_name,
      description,
      openGraph: { title: owner.full_name, description, type: 'profile' },
    };
  } catch {
    return { title: 'StandMeet' };
  }
}

export default async function Root() {
  const instance = await fetchInstance();
  // unclaimed → server redirect to /setup?t=TOKEN (token from /api/v1/instance).
  // redirect() throws so subsequent fetchPublicPage / render never runs.
  instance.claimed || redirect(`/setup?t=${instance.setup_token ?? ''}`);
  const data = await fetchPublicPage();
  return <PageShell owner={data.owner} content={data.content} />;
}
