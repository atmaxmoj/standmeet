// code-share —— build the visitor share URL for a code. Single-owner instances
// serve the public page at the root of the owner's own domain (custom domain or
// the deployed host), so the link is just <this instance's origin>?c=<code> —
// no standmeet.com, no /<handle> path (the handle is an internal id, not in the
// public URL).

// NOTE: the correct param is ?code= (useAbsorbCodeFromURL reads 'code'), which
// routes code visitors into the dedicated ChatRoom (sticky bottom-input chat).
// Held at ?c= for now: ?code= exposes a code-mode ChatRoom streaming hang (the
// agent turn completes server-side but the client SSE never terminates, so the
// answer stays stuck on "retrieving"). Flip back to ?code= once that's fixed.
export function buildShareLink(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}?c=${code}`;
}
