// upgrade-inference-usage-feature.spec.ts —— old volume + new code: the deploy brings the usage
// table's feature column (`2026-10-16-inference-usage-feature.sql`).
//
// "Done": the column arrives, the usage rows already there are kept (as feature ''), and the
// owner's usage read answers with by_feature (before the upgrade the column did not exist).
//
// Method (as upgrade-access-code-expiry): a usage row written on the new code, the column dropped
// and the migration forgotten (v0.1.158 has neither), then exactly one action: restart the backend.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const MIGRATION = '2026-10-16-inference-usage-feature.sql';
const OWNER = {
  email: 'upgrade-usage-feature@example.com', password: 'correct-horse-battery-staple',
  handle: 'upgradeusagefeature', fullName: 'Upgrade Usage Feature Owner',
};
const column = (): number => Number(querySQL(`SELECT count(*) FROM information_schema.columns
  WHERE table_name = 'inference_usage' AND column_name = 'feature'`));

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.afterAll(async () => {
  test.setTimeout(300_000);
  restartBackend();
});

test('an old volume + a deploy → the feature column arrives; usage rows are kept; by_feature answers', async ({ playwright }) => {
  test.setTimeout(600_000);
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'upgrade-usage');
  execSQL(`INSERT INTO inference_usage (owner_id, model, input_tokens, output_tokens)
    SELECT id, 'old-model', 7, 3 FROM owners LIMIT 1`);
  execSQL('ALTER TABLE inference_usage DROP COLUMN feature');
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
  expect(column(), 'pre-state built').toBe(0);

  restartBackend();

  expect(column(), 'the column arrived').toBe(1);
  expect(Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`))).toBe(1);
  expect(querySQL(`SELECT model || ':' || input_tokens || ':' || feature FROM inference_usage`),
    'the old row is kept, with no feature').toBe('old-model:7:');
  const sid = await initMCP(request, token);
  const usage = await callTool<{ by_feature?: { feature: string; model: string }[] }>(
    request, token, sid, 'instance.inference_usage', {});
  expect(usage.by_feature, 'by_feature answers').toEqual([expect.objectContaining({ feature: '', model: 'old-model' })]);
  await request.dispose();
});
