// code-share —— build the visitor share URL for a code. Single-owner instances
// serve the public page at the root of the owner's own domain (custom domain or
// the deployed host), so the link is just <this instance's origin>?c=<code> —
// no standmeet.com, no /<handle> path (the handle is an internal id, not in the
// public URL).

export function buildShareLink(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}?c=${code}`;
}
