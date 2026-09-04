// /gate — entry point for a visitor with no code, or who wants BYOAI (v1 single-owner instance).
//
// Visually matches docs/design/project/gate.html:
//   - TopBar with "private" indicator + dark toggle
//   - Hero: Seal on the left + "This isn't open." large serif headline + code input
//   - WhatsBehind: 3 lines, 01/02/03, explaining what's behind this page
//   - BYOAIPanel: the design's provider chip + reveal/hide key
//   - RequestPanel: collapsed "write a note ↘", expands into a form
//
// Business logic (POST /api/v1/sessions / access-requests) goes through useGate; this file
// only assembles the page. owner handle comes from an SSR fetch of /api/v1/instance
// (display only, doesn't affect routing).

import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiTreeStats, fetchWritingsPage } from '@/lib/api/public';
import { fetchCustomPages } from '@/lib/api/custom-pages';

import { GateClient } from '@/app/gate/gate-client';

export default async function GatePage() {
  // Fetch anonymously (no token) — these numbers/pages say exactly how much a person
  // **without a code** can reach, and that's exactly who's on this page. Fetching with
  // a token would show someone else's view.
  const [instance, wikiStats, writings, pages] = await Promise.all([
    fetchInstance(), fetchWikiTreeStats(), fetchWritingsPage(), fetchCustomPages(),
  ]);
  return (
    <GateClient
      handle={instance.handle}
      canDeliverCodes={instance.can_deliver_codes}
      publicWiki={Math.max(wikiStats.entries - wikiStats.gated, 0)}
      publicWritings={writings.writings.length}
      pages={pages}
    />
  );
}
