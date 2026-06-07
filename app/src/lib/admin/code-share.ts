// code-share —— build the visitor share URL for a code. Single-owner instances
// serve the public page at the root of the owner's own domain (custom domain or
// the deployed host), so the link is just <this instance's origin>?c=<code> —
// no standmeet.com, no /<handle> path (the handle is an internal id, not in the
// public URL).

// The param MUST be ?code= — useAbsorbCodeFromURL reads 'code', absorbs it into
// the visitor-session store, and strips it from the URL (so the code doesn't
// linger in history / screenshots / shares). That absorbed code session is what
// routes the visitor into the dedicated ChatRoom (identity picker + sticky
// bottom-input transcript). The old ?c= silently never entered code mode.
export function buildShareLink(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}?code=${code}`;
}
