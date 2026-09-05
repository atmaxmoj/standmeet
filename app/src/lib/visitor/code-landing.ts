// code-landing —— what you see when a code gets scanned.
//
// The default is the visitor chat; if the owner attached a microsite to
// this code, that's what shows instead (**pages give a code a rendering**).
// Authorization is unchanged: same role, same quota, same billing — only
// the page in front of the reader changes.
//
// A code is redeemed via two paths (submitting on /gate, or the name picker
// after entering with `?code=`). Both must land on the same place, so where
// to go is decided by this one function alone — writing it twice means a
// change to one path silently leaves the other on old behavior
// ([[copied-invalidation-goes-stale]]).

// codeLandingHref —— an empty slug returns an empty string, meaning "this
// code has no landing of its own, fall back to whatever each path defaults
// to". No default is invented here: the two paths' defaults differ (one
// needs to carry ?q= forward, the other is already on the home page).
export function codeLandingHref(slug: string): string {
  return slug === '' ? '' : `/p/${slug}`;
}
