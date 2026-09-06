// code-landing.test.ts — landAfterIssue: the one decision behind where a redeemed code lands.
// Covers test-design D-landing: microsite wins as a full nav; else the code slug drives an in-place
// rewrite to /c/<slug>; empty both → nothing.

import { describe, it, expect } from 'vitest';

import { landAfterIssue } from '@/lib/visitor/code-landing';

describe('landAfterIssue', () => {
  it('a microsite is a full navigation to its own page', () => {
    expect(landAfterIssue('my-page', 'snow123')).toEqual({ kind: 'nav', href: '/p/my-page' });
  });

  it('microsite wins over the code slug when both are present', () => {
    // The owner attached a page: what you scanned into is what you land on.
    expect(landAfterIssue('my-page', 'snow123').href).toBe('/p/my-page');
  });

  it('no microsite → the code slug rewrites the URL to /c/<slug>', () => {
    expect(landAfterIssue('', 'hire-me')).toEqual({ kind: 'rewrite', href: '/c/hire-me' });
  });

  it('neither slug → nothing to do', () => {
    expect(landAfterIssue('', '')).toEqual({ kind: 'none', href: '' });
  });
});
