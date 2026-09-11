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

import { ConsentBanner } from '@/components/monitor/ConsentBanner';
import { useConsent } from '@/lib/monitor/use-consent';
import { installTracking } from '@/lib/monitor/track';

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

export function TrackVisit(props: TrackVisitProps): React.JSX.Element {
  const { surface, entityKind, entitySlug, scroll, read, view } = props;
  // Opt-in: nothing is recorded until the visitor accepts (GDPR). `consent` is in the deps, so
  // when the banner flips it to 'accepted' the effect re-runs and THIS page's view is sent then —
  // a visitor who accepts after the page loads is still counted for the page they accepted on.
  const consent = useConsent();
  useEffect(
    () => installTracking(consent, { surface, entityKind, entitySlug }, { scroll, read, view }),
    [surface, entityKind, entitySlug, scroll, read, view, consent],
  );
  return <ConsentBanner />;
}
