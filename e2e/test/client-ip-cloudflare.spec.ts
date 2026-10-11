// client-ip-cloudflare.spec.ts —— BLACK BOX. On sijie.xyz every visitor arrived as a Cloudflare edge
// address (monitor showed `172.70.50.0/24 · AS13335 Cloudflare`): the proxy in front of the instance
// does not trust Cloudflare, so the forwarding header it passes on names the edge, and the visitor's
// own address is only in CF-Connecting-IP. Bans, the code lockout, login rate limiting and the monitor
// all keyed on the edge (owner, 2026-10-11).
//
// Contract, with zero configuration for a self-hoster: when the hop the instance resolved is inside
// Cloudflare's published ranges, CF-Connecting-IP names the visitor. From any other hop the header is
// ignored, so a request that reaches the origin directly cannot pick its own address.
//
// The stub here plays the proxy: X-Forwarded-For carries the hop it would pass on.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { addIpBan } from '@/fixtures/admin-mutations';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { openVisitorBrowser } from '@/fixtures/visitor-browser';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const CF_EDGE = '172.70.50.1'; // inside Cloudflare's 172.64.0.0/13
const NOT_CF = '192.0.2.50';
const BANNED = '203.0.113.7';
const OTHER = '198.51.100.9';
const OWNER = {
  email: 'client-ip-cf@example.com', password: 'correct-horse-battery-staple',
  handle: 'clientipcf', fullName: 'Client IP Owner',
};
const PATH = 'client-ip-note';

let token = '';
let sid = '';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  await initOwnerWithEntry(playwright);
});

test('a ban hits the visitor behind Cloudflare, not everyone on the same edge', async ({ playwright }) => {
  const request = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await addIpBan(request, csrf, { ip: BANNED, reason: 'e2e behind cloudflare' });

  expect(await statusFrom(request, CF_EDGE, BANNED), 'the banned visitor is refused').toBe(403);
  expect(await statusFrom(request, CF_EDGE, OTHER), 'another visitor on the same edge is served').toBe(201);
  expect(await statusFrom(request, NOT_CF, BANNED),
    'from a non-Cloudflare hop the header is not believed').toBe(201);
  await request.dispose();
});

test('the monitor records the visitor\'s network, not Cloudflare\'s', async ({ playwright, request }) => {
  const ctx = await openVisitorBrowser(playwright, { 'X-Forwarded-For': CF_EDGE, 'CF-Connecting-IP': '8.8.8.8' });
  await ctx.read(`/wiki/${PATH}`);
  await ctx.dispose();
  const page = await callTool<{ items: { network: string }[] }>(request, token, sid, 'monitor.sessions', { window: '7d' });
  const nets = page.items.map((s) => s.network);
  expect(nets, 'the visitor\'s /24').toContain('8.8.8.0/24');
  expect(nets, 'never the edge').not.toContain('172.70.50.0/24');
});

async function statusFrom(request: APIRequestContext, hop: string, visitor: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/access-requests`, {
    headers: { 'X-Forwarded-For': hop, 'CF-Connecting-IP': visitor },
    data: {
      name: 'Probe', org: 'x', email: 'probe@example.com',
      message: 'requesting access to read your work and projects please',
    },
  });
  return res.status();
}

async function initOwnerWithEntry(playwright: Playwright): Promise<void> {
  resetInstance();
  const ctx = await playwright.request.newContext();
  await claim(ctx, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(ctx, OWNER.email, OWNER.password);
  token = await createAPIToken(ctx, csrf, 'client-ip-cf');
  sid = await initMCP(ctx, token);
  const { wikiID: id } = await seedWiki(ctx, token, sid, { title: 'Client IP', body: 'A note.', path: PATH });
  await publishEntry(ctx, token, sid, { genre: 'wiki', id });
  await ctx.dispose();
}
