// job-sources-register.spec.ts —— owner via MCP registers a Greenhouse
// source, sees it in list_sources, then unregister + list = empty.
//
// Phase 1 surface is MCP-only (per CLAUDE.md "daily flow is Claude-driven";
// admin UI for /admin/sources is deferred — owner does this via Claude).
// Same precedent as corpus-curation.spec.ts.

import { test, expect } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import {
  jobsRegisterSource, jobsListSources, jobsUnregisterSource,
} from '@/fixtures/jobs';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('owner registers + unregisters job sources via MCP', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('register Greenhouse source → list shows it → unregister → list empty',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'jobs-spec');
      const sid = await initMCP(request, token);

      // Pre-state: zero sources
      const initial = await jobsListSources(request, token, sid);
      expect(initial.sources).toHaveLength(0);

      // Register
      const created = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse',
        label: 'Vercel careers',
        config: { company: 'vercel' },
      });
      expect(created.kind).toBe('greenhouse');
      expect(created.label).toBe('Vercel careers');
      expect(created.config).toEqual({ company: 'vercel' });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

      // List shows it
      const afterCreate = await jobsListSources(request, token, sid);
      expect(afterCreate.sources).toHaveLength(1);
      expect(afterCreate.sources[0]?.id).toBe(created.id);

      // Unregister + list empty
      const drop = await jobsUnregisterSource(request, token, sid, created.id);
      expect(drop.ok).toBe(true);

      const afterDrop = await jobsListSources(request, token, sid);
      expect(afterDrop.sources).toHaveLength(0);
    });
});
