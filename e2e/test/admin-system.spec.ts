// admin-system.spec.ts —— admin system section: terminal block, background jobs,
// health checks.
//
// User story:
//   1. terminal block → version / uptime renders
//   2. background jobs table → rows visible
//   3. health checks → status dots (ok = accent / warn = amber)

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'system@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'system',
  fullName: 'System Owner',
};

interface HealthCheck { name: string; ok: boolean; detail: string }
interface SystemInfo {
  version: string;
  uptime_seconds: number;
  goroutines: number;
  mem_alloc_mb: number;
  num_cpu: number;
  disk_total_mb: number;
  disk_free_mb: number;
  mem_total_mb: number;
  mem_used_mb: number;
  load_avg_1: number;
  health: HealthCheck[];
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin system section', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('terminal block renders version + uptime',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      await adminPage.waitForURL('**/admin/system', { timeout: 5_000 });
      const terminal = adminPage.getByTestId('system-terminal');
      await expect(terminal).toBeVisible();
      await expect(terminal).toContainText(/version/i);
    });

  test('background jobs table visible',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      const jobsTable = adminPage.getByTestId('system-jobs');
      await expect(jobsTable).toBeVisible();
      // Should have at least some rows
      const rows = jobsTable.locator('tr');
      await expect(rows).not.toHaveCount(0);
    });

  test('health checks render with status dots',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      const checks = adminPage.getByTestId('system-health');
      await expect(checks).toBeVisible();
      // Status dots should be present
      const dots = checks.locator('[data-testid="health-dot"]');
      await expect(dots.first()).toBeVisible();
    });

  // #101: real system-info backend — real version/uptime/runtime + real health pings
  // (no longer hardcoded "ok").
  test('GET /api/admin/system returns real version/uptime/runtime + real health pings',
    async ({ adminPage }) => {
      const res = await adminPage.request.get(`${BACKEND}/api/admin/system`);
      expect(res.status(), 'system endpoint 200').toBe(200);
      const body = await res.json() as SystemInfo;

      expect(body.version, 'version present (not placeholder)').toBeTruthy();
      expect(body.version).not.toBe('—');
      expect(body.uptime_seconds, 'uptime is a real ≥0 number').toBeGreaterThanOrEqual(0);
      expect(body.num_cpu, 'num_cpu ≥ 1').toBeGreaterThanOrEqual(1);
      expect(body.goroutines, 'goroutines ≥ 1').toBeGreaterThanOrEqual(1);

      // health is a real ping — in e2e both db/redis are up, so it must be ok.
      const db = body.health.find((h) => h.name === 'database');
      expect(db, 'database health present').toBeTruthy();
      expect(db?.ok, 'database ping really ok').toBe(true);
      const redis = body.health.find((h) => h.name === 'redis');
      expect(redis?.ok, 'redis ping really ok').toBe(true);
    });

  // Basic host resources — a self-hosting owner is also the operator, and
  // disk/memory/load are what they check first.
  // Assert invariants (not exact values): these distinguish "really read the host
  // resources" from "field missing / always 0".
  test('GET /api/admin/system exposes real host disk / memory / load', async ({ adminPage }) => {
    const res = await adminPage.request.get(`${BACKEND}/api/admin/system`);
    expect(res.status(), 'system endpoint 200').toBe(200);
    const body = await res.json() as SystemInfo;

    // Disk: total is a real positive value, free falls within [0, total].
    expect(body.disk_total_mb, 'disk total is real (>0)').toBeGreaterThan(0);
    expect(body.disk_free_mb, 'disk free ≥ 0').toBeGreaterThanOrEqual(0);
    expect(body.disk_free_mb, 'disk free ≤ total').toBeLessThanOrEqual(body.disk_total_mb);
    // Host memory (not the Go heap): total is positive, used falls within [0, total],
    // and it's distinct from mem_alloc_mb.
    expect(body.mem_total_mb, 'host mem total is real (>0)').toBeGreaterThan(0);
    expect(body.mem_used_mb, 'host mem used ≥ 0').toBeGreaterThanOrEqual(0);
    expect(body.mem_used_mb, 'host mem used ≤ total').toBeLessThanOrEqual(body.mem_total_mb);
    expect(body.mem_total_mb, 'host RAM ≫ Go heap (distinct metric)').toBeGreaterThan(body.mem_alloc_mb);
    // CPU load (1min): real, non-negative.
    expect(body.load_avg_1, 'load avg ≥ 0').toBeGreaterThanOrEqual(0);
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
