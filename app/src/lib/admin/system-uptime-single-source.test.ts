// system-uptime-single-source.test.ts —— what the uptime formatter must guarantee, checked
// without a clock.
//
// UX-27 was the defect: the sidebar footer rendered `uptime · —` where the dash was a JSX
// LITERAL, while /admin/system showed the real value at the same moment. The fix pointed both at
// `useSystemInfo` + `deployView`.
//
// The e2e that guarded it read the footer, navigated to /admin/system, and compared the two
// strings character for character. Character-exact was the right strength — "both look like a
// duration" passes with two independently-computed values — but between the two reads the store
// refetched, so it compared two moments of a RUNNING clock and could only pass inside one second.
// It failed "6m 46s" vs "6m 50s" with the feature working exactly as designed.
//
// Split the claim in two, and neither half needs luck:
//   here      — the formatter is total, and absence reads as absence.
//   the e2e   — both surfaces show the identical string ON ONE SCREEN (the footer is on every
//               admin page, so no navigation is needed). That is what goes red if either
//               component starts computing its own uptime.

import { describe, expect, it } from 'vitest';

import { deployView, type SystemInfo } from '@/lib/admin/use-system-info';

const INFO = {
  version: 'v0.1.23',
  num_cpu: 8,
  uptime_seconds: 406, // 6m 46s — the value the e2e tripped on
  public_ip: '203.0.113.7',
} as unknown as SystemInfo;

describe('deployView · the one formatter both uptime surfaces call', () => {
  it('is a function of info alone — same input, same string', () => {
    expect(deployView(INFO).uptime).toBe('6m 46s');
    expect(deployView(INFO).uptime).toBe(deployView(INFO).uptime);
  });

  it('reads absence as absence, not as zero uptime', () => {
    // "0s" would be a claim about the instance; "—" is the refusal to make one. A surface that
    // prints 0s on a failed fetch is the same class of lie as the literal dash UX-27 removed.
    expect(deployView(null).uptime).toBe('—');
    expect(deployView(null).version).toBe('—');
  });

  it('an empty public IP is a placeholder, a present one is passed through', () => {
    expect(deployView({ ...INFO, public_ip: '' } as SystemInfo).ip).toBe('—');
    expect(deployView(INFO).ip).toBe('203.0.113.7');
  });
});
