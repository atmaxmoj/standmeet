// owner-key-tool-allowlist.spec.ts —— roadmap 8.5.a: an owner MCP key limited to a few tools.
//
// "Done" (roadmap): Job Scout's key calls jobs.record; corpus.delete and applications.commit are
// refused.
//
// Contract:
//   - POST /api/admin/keypairs takes an optional `tools: string[]`; the key row carries `tools`
//     ([] = every tool its scopes cover). The admin form offers the preset `jobscout`.
//   - tools/list for such a key shows only listed tools (within its scopes); a call to any other
//     tool is refused, the message naming the tool and "tool list".
//   - The key row in /admin says which tools: `token-tools-<label>`.

import { test, expect } from '@/fixtures/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { callToolOutcome, initMCP, listTools } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsRecord } from '@/fixtures/job-ledger';

const OWNER = {
  email: 'keytools@example.com', password: 'correct-horse-battery-staple',
  handle: 'keytools', fullName: 'Key Tools',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  await claimFreshOwner(playwright, OWNER);
});

test('a key with a tool list lists and runs only those tools', async ({ request }) => {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const full = await createAPIToken(request, csrf, 'full-key');
  const fullNames = (await listTools(request, full, await initMCP(request, full))).map((t) => t.name);
  expect(fullNames, 'presence: a full key reaches applications.commit').toContain('applications.commit');

  const scout = await createAPIToken(request, csrf, 'job-scout', ['read', 'write'], ['jobs.record', 'jobs.history']);
  const sid = await initMCP(request, scout);
  const names = (await listTools(request, scout, sid)).map((t) => t.name).sort();
  expect(names, 'only the listed tools').toEqual(['jobs.history', 'jobs.record']);

  const [rec] = await jobsRecord({ request, apiToken: scout, sid }, [{
    title: 'Scout Engineer', company: 'Scout Co', url: 'https://jobs.scout.example/1',
  }]);
  expect(rec?.new, 'a listed tool runs').toBe(true);

  for (const tool of ['applications.commit', 'corpus.delete']) {
    const out = await callToolOutcome(request, scout, sid, tool, {});
    expect(out.isError, `${tool} refused`).toBe(true);
    expect(out.text, 'naming the tool and the list').toMatch(new RegExp(`${tool.replace('.', '\\.')}.*tool list`, 'i'));
  }
});

test('the admin form offers a Job Scout key, and its row says which tools', async ({ adminPage: page }) => {
  await gotoAdminSection(page, 'api-mcp');
  await page.getByTestId('token-name').fill('scout-laptop');
  await page.getByTestId('token-scope').selectOption('jobscout');
  await page.getByTestId('token-create').click();
  const tools = page.getByTestId('token-tools-scout-laptop');
  await expect(tools).toContainText('jobs.record', { timeout: 10_000 });
  await expect(tools).not.toContainText('corpus.delete');
  await page.reload();
  await expect(page.getByTestId('token-tools-scout-laptop'), 'stored, not just shown').toContainText('jobs.record');
});
