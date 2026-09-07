// TrackVisit —— drop this on a public page and its visit is recorded.
//
// It renders nothing. It exists because the backend cannot see these pages: the app renders
// them, and the only backend call involved in the index is a liveness probe that fires whether
// or not a person is there. Without this component, surface `index` has no signal at all.
//
// Deliberately not on admin pages. The owner reading their own site is excluded server-side
// too, but the cheapest exclusion is not asking.

'use client';

import { useEffect } from 'react';

import { send, watchScroll, watchRead } from '@/lib/monitor/beacon';
import { watchClicks } from '@/lib/monitor/clicks';

export interface TrackVisitProps {
  surface: string;
  entityKind?: string;
  entitySlug?: string;
  // scroll —— also report reading depth. Worth it on a long page, noise on a short one.
  scroll?: boolean;
  // read —— this page has an END. Adds read-complete and the dwell bucket on top of `scroll`,
  // which are the two questions only a reading page can answer. The index scrolls too, but
  // "scrolled past the footer" is not "finished the article".
  read?: boolean;
  // view —— report that the page was opened. Default true.
  //
  // Set it false on a page the BACKEND already records. The corpus reader is one: its data
  // comes from an API route the middleware observes, so a beacon view there would count every
  // read twice, and a doubled number is worse than a missing one — it looks like success.
  view?: boolean;
}

export function TrackVisit(props: TrackVisitProps): null {
  const { surface, entityKind, entitySlug, scroll, read, view } = props;
  useEffect(() => {
    const event = { surface, entityKind, entitySlug };
    // The view first, so a visitor who leaves immediately is still a visitor.
    view === false || send(event);
    // The click rules are installed on every tracked page, not only reading ones: each rule
    // names the surface it reports on, so a rule whose element is not on this page simply never
    // matches, and one that is (the chat rail's citations, on a reader page) still counts.
    const stopClicks = watchClicks(event);
    const stopScroll = depthWatcher(read, scroll)?.(event);
    return () => { stopClicks(); stopScroll?.(); };
  }, [surface, entityKind, entitySlug, scroll, read, view]);
  return null;
}

// depthWatcher —— which scroll watcher this page wants, or none. `read` implies `scroll`: a page
// with an end is a page that scrolls, and making the caller pass both is a way to end up with a
// reading page that reports completion and no depth.
function depthWatcher(read?: boolean, scroll?: boolean) {
  return read === true ? watchRead : scroll === true ? watchScroll : null;
}
