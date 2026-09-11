// consent —— the visitor's tracking consent (GDPR accept/decline). Opt-in: nothing is recorded
// until the visitor accepts. The choice lives in this browser's localStorage only — it is the
// visitor's own preference, never sent anywhere, and a returning visitor is not asked again.
//
// The recording it gates is already cookieless and stores no IP (monitor.md §4/§8); the banner is
// the explicit-consent layer the owner asked for on top of that, so a visitor who declines produces
// no beacon at all.

export type Consent = 'accepted' | 'declined' | 'unset';

const KEY = 'sm_consent';

// CONSENT_EVENT —— fired on this window when the choice changes, so a banner in one component and
// the tracker in another react to the same click without prop-drilling between them.
export const CONSENT_EVENT = 'sm-consent-change';

// readConsent —— the stored choice, or 'unset' when there is none / storage is unavailable (a
// private window, blocked site data). 'unset' means "not yet decided" = do not track.
export function readConsent(): Consent {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'accepted' || v === 'declined' ? v : 'unset';
  } catch {
    return 'unset';
  }
}

// setConsent —— record the visitor's choice and tell the page. A storage failure (private mode)
// still dispatches the event, so the choice holds for this page even if it can't be remembered.
export function setConsent(choice: 'accepted' | 'declined'): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Private mode / blocked: honour the choice for this page view; it just won't be remembered.
  }
  try {
    window.dispatchEvent(new Event(CONSENT_EVENT));
  } catch {
    // No window (SSR) — nothing is subscribed there anyway.
  }
}

// subscribeConsent —— re-run `cb` when the choice changes: the banner's own click (CONSENT_EVENT)
// and another tab's change ('storage'). Returns its teardown.
export function subscribeConsent(cb: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CONSENT_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
