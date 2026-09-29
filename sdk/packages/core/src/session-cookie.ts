// session-cookie.ts — the one name for the presence-only session flag cookie.
//
// It lives in its own module so the edge middleware can import just this string without pulling
// in the whole visitor session store (zustand + localStorage code). The session store mirrors
// this cookie on every write; the middleware reads it to route `/` (coded app vs codeless
// homepage). It carries NO session data — presence only.
export const SESSION_COOKIE = 'sm-session';
