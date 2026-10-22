// /og/site —— the site's share card (lib/og-card). The homepage and every page without its own
// card point here; the backend does too, for the pages it serves.

import { drawSiteCard } from '@/lib/og-card';

export const dynamic = 'force-dynamic';

export function GET(): Promise<Response> {
  return drawSiteCard();
}
