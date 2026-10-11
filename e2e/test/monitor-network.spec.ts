// monitor-network.spec.ts —— BLACK BOX. The owner saw 1581 views from Singapore in one row and could
// not tell whether it was a person or a data centre: the instance stores no IP, and nothing else said
// where on the internet a visitor sat (owner, 2026-10-11).
//
// Contract: each visit records the visitor's network at organisation grain — the /24 an IPv4 address
// sits in, the /48 of an IPv6 one — and the autonomous system that announces it (number + owner, from
// the bundled db-ip ASN Lite database). The full IP is still never stored or shown. The sessions panel
// and monitor.sessions / monitor.events carry `network`, `asn`, `as_org`.
//
// Inputs are Google's public resolvers, a stable, well-known data-centre network; the expected AS is
// read at runtime from an INDEPENDENT provider (ip-api), not hardcoded.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { openVisitorBrowser } from '@/fixtures/visitor-browser';

const OWNER = {
  email: 'monitor-network@example.com', password: 'correct-horse-battery-staple',
  handle: 'monitornetwork', fullName: 'Monitor Network Owner',
};
const ENTRY = { title: 'Network Note', path: 'network-note' };
const V4 = { ip: '8.8.8.8', network: '8.8.8.0/24' };
const V6 = { ip: '2001:4860:4860::8888', network: '2001:4860:4860::/48' };

interface SessionItem { network?: string; asn?: number; as_org?: string; country: string }

// independentASN —— the AS number another provider reports for the IP ("AS15169 Google LLC" → 15169).
async function independentASN(ip: string): Promise<number> {
  const res = await fetch(`http://ip-api.com/json/${ip}?fields=as,status`);
  const j = (await res.json()) as { status: string; as?: string };
  const m = /^AS(\d+)\b/.exec(j.as ?? '');
  if (j.status !== 'success' || !m) throw new Error(`independent ASN lookup failed for ${ip}: ${JSON.stringify(j)}`);
  return Number(m[1]);
}

let token = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  await initOwnerWithEntry(playwright);
  for (const v of [V4, V6]) {
    const ctx = await openVisitorBrowser(playwright, { 'X-Forwarded-For': v.ip });
    await ctx.read(`/wiki/${ENTRY.path}`);
    await ctx.dispose();
  }
});

test('monitor.sessions names each visitor\'s network and AS, never the address', async ({ request }) => {
  const asn = await independentASN(V4.ip);
  const page = await callTool<{ items: SessionItem[] }>(request, token, sid, 'monitor.sessions', { window: '7d' });
  const nets = page.items.map((s) => s.network);
  expect(nets, 'IPv4 at /24').toContain(V4.network);
  expect(nets, 'IPv6 at /48').toContain(V6.network);
  const v4 = page.items.find((s) => s.network === V4.network)!;
  expect(v4.asn, 'the AS an independent provider reports').toBe(asn);
  expect(v4.as_org, 'the network owner by name').toMatch(/google/i);
  expect(JSON.stringify(page.items), 'the full address is never returned').not.toContain(V4.ip);
  expect(JSON.stringify(page.items)).not.toContain(V6.ip);
});

test('the sessions panel shows the AS and network on the row', async ({ adminPage }) => {
  await gotoAdminSection(adminPage, 'monitor');
  await adminPage.getByTestId('monitor-tab-sessions').click();
  const row = adminPage.getByTestId('monitor-session-row').filter({ hasText: V4.network });
  await expect(row, 'a row for the IPv4 visitor').toHaveCount(1, { timeout: 20_000 });
  await expect(row.getByTestId('monitor-session-network')).toContainText(/AS\d+ .*Google/i);
  await expect(row.getByTestId('monitor-session-network')).toContainText(V4.network);
  await expect(row, 'the full address is not on screen').not.toContainText(V4.ip);
});

async function initOwnerWithEntry(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  token = await createAPIToken(request, csrf, 'monitor-network');
  sid = await initMCP(request, token);
  const { wikiID: id } = await seedWiki(request, token, sid, {
    title: ENTRY.title, body: 'A note read from a data centre.', path: ENTRY.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id });
}
