// admin-ip-bans.spec.ts —— owner bans an IP → the public surface blocks it
// (#58-4). Admin CRUD (POST/GET/DELETE /api/admin/ip-bans) drives banned_ips;
// the public BanGuard 403s any request whose source IP is banned. We spoof the
// source via X-Forwarded-For (chi.RealIP honours it) so the test never bans its
// own IP and lock itself out.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { login } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const BANNED = '203.0.113.7';
const ALLOWED = '198.51.100.9';

const OWNER = {
  email: 'ipban@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ipban',
  fullName: 'IP Ban Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin ip bans', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('ban an IP → public 403 → unban → allowed again',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      try {
        const { csrf } = await login(request, OWNER.email, OWNER.password);

        const id = await banIP(request, csrf, BANNED);
        expect(await listContains(request, BANNED)).toBe(true);

        // Enforcement: banned source 403s; a different source still gets through.
        expect(await publicStatusFrom(request, BANNED)).toBe(403);
        expect(await publicStatusFrom(request, ALLOWED)).toBe(201);

        await unbanIP(request, csrf, id);
        expect(await publicStatusFrom(request, BANNED)).toBe(201);
      } finally {
        await request.dispose();
      }
    });
});

async function banIP(request: APIRequestContext, csrf: string, ip: string): Promise<string> {
  const res = await request.post(`${BACKEND}/api/admin/ip-bans/`, {
    headers: { 'X-Csrftoken': csrf },
    data: { ip, reason: 'e2e abuse' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json() as { id: string };
  return body.id;
}

async function unbanIP(request: APIRequestContext, csrf: string, id: string): Promise<void> {
  const res = await request.delete(`${BACKEND}/api/admin/ip-bans/${id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status()).toBe(200);
}

async function listContains(request: APIRequestContext, ip: string): Promise<boolean> {
  const res = await request.get(`${BACKEND}/api/admin/ip-bans/`);
  const rows = await res.json() as { ip: string }[];
  return rows.some((r) => r.ip === ip);
}

async function publicStatusFrom(request: APIRequestContext, ip: string): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/access-requests`, {
    headers: { 'X-Forwarded-For': ip },
    data: {
      name: 'Probe', org: 'x', email: 'probe@example.com',
      message: 'requesting access to read your work and projects please',
    },
  });
  return res.status();
}
