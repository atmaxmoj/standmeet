// guide-store-docs.spec.ts —— #11: the microsite authoring guide (microsite.guide, served on both
// the MCP and HTTP faces) documents the per-page STORE, so an author reading it knows the store
// exists — before this, useMicrositeStore was a real SDK block the guide never mentioned.
//
// Positive content assertion (the guide SAYS the thing), not an absence test.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'guide-store@example.com', password: 'correct-horse-battery-staple',
  handle: 'guidestore', fullName: 'Guide Store Owner',
};

test.describe('microsite.guide documents the per-page store', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the authoring guide covers useMicrositeStore and how to persist page state', async ({ playwright }) => {
    const api: APIRequestContext = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    const res = await api.get(`${BACKEND}/api/admin/microsites/guide`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect(res.status(), 'guide served').toBe(200);
    const guide = ((await res.json()) as { guide?: string }).guide ?? '';
    expect(guide, 'guide documents the store hook').toContain('useMicrositeStore');
    expect(guide, 'guide names the store-writable control').toContain('set_store_writable');
    await api.dispose();
  });
});
