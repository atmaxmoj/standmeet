// code-share —— build share URL for a code. Static host for now.

const HOST = 'standmeet.com';

export function buildShareLink(code: string, handle?: string): string {
  const path = handle ? `/${handle}` : '';
  return `https://${HOST}${path}?c=${code}`;
}
