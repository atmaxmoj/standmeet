// code-landing —— where the browser goes once a code session is issued.
//
// Two outcomes, one decision so the three claim paths (the name picker, a /gate
// submit, re-opening the same link) never drift apart ([[copied-invalidation-goes-stale]]):
//
//   • the owner attached a microsite to this code → a FULL navigation to
//     `/p/<microsite>` (that page is a build artifact with its own route tree,
//     not part of this Next app — a router.push would not reach it);
//   • no microsite → a SOFT rewrite of the URL to `/c/<slug>`. The chat already
//     rendered in place, so only the address bar changes: the raw `?code=` leaves
//     the URL and the conversation gets a stable path. The slug is a LOCATOR, not
//     a credential — visiting `/c/<slug>` without the stored session grants nothing.

// LandKind —— nav: full page load (microsite); rewrite: in-place history swap
// (coded chat gets its /c/<slug> path); none: nothing to do (no microsite, no slug).
export type LandKind = 'nav' | 'rewrite' | 'none';

export interface Landing {
  kind: LandKind;
  href: string;
}

// landAfterIssue —— the pure decision. micrositeSlug wins (full nav); else the
// code's own slug drives an in-place rewrite; empty both → nothing.
export function landAfterIssue(micrositeSlug: string, codeSlug: string): Landing {
  if (micrositeSlug !== '') return { kind: 'nav', href: `/p/${micrositeSlug}` };
  if (codeSlug !== '') return { kind: 'rewrite', href: `/c/${codeSlug}` };
  return { kind: 'none', href: '' };
}

// applyLanding —— the one side-effecting half. Kept next to the decision so a
// caller can't apply a 'rewrite' as a full nav (which would reload and lose the
// just-issued in-memory session) or vice-versa.
export function applyLanding(l: Landing): void {
  if (typeof window === 'undefined' || l.kind === 'none') return;
  if (l.kind === 'nav') {
    window.location.assign(l.href);
    return;
  }
  window.history.replaceState(null, '', l.href);
}
