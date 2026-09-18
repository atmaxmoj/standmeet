// dsh-market-live.spec.ts — the REAL dsh block-marketplace connection, opt-in.
//
// Default-SKIPPED. Set DSH_MARKET_LIVE=1 (make test-dsh-live) to actually reach npm and prove
// the upstream `blocks.marketplace_search` / `blocks.marketplace_install` depend on is live and
// shaped as our client (internal/marketplace/usecase/blockmarket.go) assumes: dsh has no
// registry of its own, so we piggyback npm — its plugins live under @deepseek-ai/cordis-plugin-*
// (and community koishi-plugin-*). This hits npm directly with the exact query/URL the client
// builds, so it validates the market + our assumptions without a live-network dependency in the
// default suite (the vault-roundtrip-noop opt-in shape; a silent skip is called out in the log).

import { test, expect } from '@playwright/test';

const LIVE = process.env['DSH_MARKET_LIVE'] === '1';
const NPM = 'https://registry.npmjs.org';
// dshScopeQuery — the same default query blockmarket.go sends for an empty search.
const DSH_SCOPE = '@deepseek-ai/cordis-plugin';
// isDshBlockName — mirrors the client's naming filter (blockmarket.go isDshBlockName).
const isDshBlockName = (n: string): boolean =>
  /cordis-plugin/.test(n) || /^koishi-plugin-/.test(n) || /\/koishi-plugin-/.test(n);

test.describe('dsh marketplace · real npm connection (opt-in: DSH_MARKET_LIVE=1)', () => {
  test('npm search returns real dsh-ecosystem blocks our filter keeps', async ({ request }) => {
    test.skip(!LIVE, 'set DSH_MARKET_LIVE=1 to hit real npm — make test-dsh-live');
    const url = `${NPM}/-/v1/search?text=${encodeURIComponent(DSH_SCOPE)}&size=25`;
    const res = await request.get(url);
    expect(res.status(), 'npm search reachable').toBe(200);
    const body = (await res.json()) as { objects?: { package: { name: string } }[] };
    const names = (body.objects ?? []).map((o) => o.package.name);
    expect(names.length, 'npm returned a result page').toBeGreaterThan(0);
    const kept = names.filter(isDshBlockName);
    expect(kept.length, `real dsh blocks in the market (first names: ${names.slice(0, 5).join(', ')})`)
      .toBeGreaterThan(0);
  });

  test('a known dsh package resolves to an installable tarball', async ({ request }) => {
    test.skip(!LIVE, 'set DSH_MARKET_LIVE=1 to hit real npm — make test-dsh-live');
    const res = await request.get(`${NPM}/@deepseek-ai/cordis-plugin-timer`);
    expect(res.status(), 'package doc reachable').toBe(200);
    const doc = (await res.json()) as {
      'dist-tags'?: { latest?: string };
      versions?: Record<string, { dist?: { tarball?: string } }>;
    };
    const latest = doc['dist-tags']?.latest;
    expect(latest, 'latest version tag present').toBeTruthy();
    const tarball = latest ? doc.versions?.[latest]?.dist?.tarball : undefined;
    expect(tarball, 'installable tarball url present').toContain('.tgz');
  });
});
