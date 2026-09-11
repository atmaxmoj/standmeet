// use-consent —— the visitor's tracking consent as reactive state. Backed by localStorage +
// the CONSENT_EVENT, via useSyncExternalStore so a click in the banner re-renders the tracker
// that reads it. Server snapshot is 'unset' (no localStorage there), which is also the correct
// pre-decision default: do not track.

import { useSyncExternalStore } from 'react';

import { readConsent, subscribeConsent, type Consent } from '@/lib/monitor/consent';

export function useConsent(): Consent {
  return useSyncExternalStore(subscribeConsent, readConsent, serverConsent);
}

function serverConsent(): Consent {
  return 'unset';
}
