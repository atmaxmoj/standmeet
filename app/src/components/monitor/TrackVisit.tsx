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

import { send, watchScroll } from '@/lib/monitor/beacon';

export interface TrackVisitProps {
  surface: string;
  entityKind?: string;
  entitySlug?: string;
  // scroll —— also report reading depth. Worth it on a long page, noise on a short one.
  scroll?: boolean;
  // view —— report that the page was opened. Default true.
  //
  // Set it false on a page the BACKEND already records. The corpus reader is one: its data
  // comes from an API route the middleware observes, so a beacon view there would count every
  // read twice, and a doubled number is worse than a missing one — it looks like success.
  view?: boolean;
}

export function TrackVisit(props: TrackVisitProps): null {
  const { surface, entityKind, entitySlug, scroll, view } = props;
  useEffect(() => {
    const event = { surface, entityKind, entitySlug };
    // The view first, so a visitor who leaves immediately is still a visitor.
    view === false || send(event);
    return scroll === true ? watchScroll(event) : undefined;
  }, [surface, entityKind, entitySlug, scroll, view]);
  return null;
}
