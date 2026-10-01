// upgrade-instance-owner-settings.spec.ts — an old instance upgrades and keeps its settings.
//
// Owner, 2026-10-01: "升级场景测试". The instance settings moved out of the deployment
// (2026-10-01-instance-owner-settings.sql): Turnstile keys, internal hosts, the skill catalogue
// used to be env vars. An instance already running carries them in its own compose (sijie's
// Coolify compose has the Turnstile pair). If the upgrade only added empty columns, that instance
// would come back with its login check silently OFF — the owner would never see it happen.
//
// So the backend imports the old env once, into fields still empty, and marks the import done (an
// owner who later clears a field in the UI must not have it refilled on the next restart).
//
// Method (mirrors the other upgrade-* specs): on a DB that already has an owner, roll back to the
// real pre-upgrade shape — drop the columns AND delete this migration's ledger row — then do one
// thing: deploy the backend again, carrying the old deployment's environment.
//
// Serial (workers:1): the DB is briefly in an old shape mid-run.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login, putInstanceSettings } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, recreateBackendWithEnv, resetInstance,
} from '@/fixtures/instance';

const MIGRATION = '2026-10-01-instance-owner-settings.sql';
const COLUMNS = [
  'internal_hosts', 'captcha_site_key', 'captcha_secret_enc', 'skill_catalogue_url',
  'legacy_env_imported',
];
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'settings-upgrader@example.com', password: 'correct-horse-battery-staple',
  handle: 'settingsupgrader', fullName: 'Sam Upgrader',
};

// What the old deployment carried (Cloudflare's always-pass test pair; in-stack stand-in hosts).
const OLD_ENV = {
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
  EGRESS_ALLOW_HOSTS: 'llm-gateway',
  SUPPLIER_EGRESS_ALLOW: 'external-mock',
  MARKETPLACE_GITHUB_BASE_URL: 'http://external-mock:9000/marketplace/github',
};

function columnCount(): number {
  const list = COLUMNS.map((c) => `'${c}'`).join(',');
  return Number(querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name='instance_settings' AND column_name IN (${list})`,
  ));
}

function downgrade(): void {
  execSQL(`ALTER TABLE instance_settings ${COLUMNS.map((c) => `DROP COLUMN IF EXISTS ${c}`).join(', ')}`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

test.describe('upgrade · an instance configured by env keeps its settings', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  // Deploy again without the old environment, whatever happened above.
  test.afterAll(() => { recreateBackendWithEnv({}); });

  test('the deploy adds the columns and imports the old env', async ({ playwright }) => {
    downgrade();
    expect(columnCount(), 'the old shape was not made — this would test nothing').toBe(0);

    recreateBackendWithEnv(OLD_ENV);
    expect(columnCount(), 'the deploy applied the migration').toBe(COLUMNS.length);

    const settings = await readSettings(playwright);
    expect(settings.captcha_site_key).toBe(OLD_ENV.TURNSTILE_SITE_KEY);
    expect(settings.captcha_secret_configured, 'the secret came over, sealed').toBe(true);
    expect(settings.internal_hosts).toEqual(['llm-gateway', 'external-mock']);
    expect(settings.skill_catalogue_url).toBe(OLD_ENV.MARKETPLACE_GITHUB_BASE_URL);

    const instance = await (await playwright.request.newContext()).get(`${BACKEND}/api/v1/instance`);
    const body = await instance.json() as { captcha_site_key?: string };
    expect(body.captcha_site_key, 'the login check is still on after the upgrade')
      .toBe(OLD_ENV.TURNSTILE_SITE_KEY);
  });

  test('a field the owner cleared stays cleared on the next deploy', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await putInstanceSettings(request, OWNER, { internal_hosts: [], skill_catalogue_url: '' });

    recreateBackendWithEnv({ ...OLD_ENV, EGRESS_ALLOW_HOSTS: 'llm-gateway,somewhere-else' });
    const settings = await readSettings(playwright);
    expect(settings.internal_hosts, 'not refilled from the env').toEqual([]);
    expect(settings.skill_catalogue_url).toBe('');
  });
});

interface Settings {
  internal_hosts: string[]; skill_catalogue_url: string;
  captcha_site_key: string; captcha_secret_configured: boolean;
}

async function readSettings(playwright: Playwright): Promise<Settings> {
  const request = await playwright.request.newContext();
  await login(request, OWNER.email, OWNER.password);
  const res = await request.get(`${BACKEND}/api/admin/instance-settings`);
  expect(res.status(), 'GET /api/admin/instance-settings').toBe(200);
  return await res.json() as Settings;
}
