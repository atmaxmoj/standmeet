// prerender-passthrough.spec.ts —— the "plugin genuinely required → pre-render on the
// Obsidian side at export, ingest the static result" tier (design line 31/39). The
// owner runs Dataview/Templater into static markdown on the Obsidian side (tables/
// expanded text), and StandMeet only ingests that static result — sync preserves it
// verbatim, and the reader renders it in full. Mostly confirms "no special handling":
// the body is just markdown, and static content passes through naturally.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { makeVaultMD, uploadVault } from '@/fixtures/obsidian';
import {
  claimSyncOwner, syncOwner, syncSession, syncRead, type SyncOwner,
} from '@/fixtures/vault-sync';

type Ctx = { playwright: Playwright };
const OWNER: SyncOwner = syncOwner('pp');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('pre-render passthrough', () => {
  test.beforeEach(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await claimSyncOwner(request, OWNER);
    await request.dispose();
  });

  test('a baked static markdown table (ex-Dataview) survives sync verbatim', bakedTable);
  test('expanded static text (ex-Templater) is ingested as plain body, no re-processing', expandedText);
});

async function bakedTable({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  const table = '| Note | Tag |\n| --- | --- |\n| Ashby | cybernetics |\n| Kepler | orbit |';
  await uploadVault(request, OWNER, [
    { rel: 'wiki/baked.md', body: makeVaultMD({ publish: true }, 'Pre-baked:\n\n' + table) },
  ]);
  const sess = await syncSession(request, OWNER);
  const body = (await syncRead(request, sess, 'baked')).body ?? '';
  expect(body, 'the static table rows survive intact').toContain('| Ashby | cybernetics |');
  expect(body).toContain('| Kepler | orbit |');
  await request.dispose();
}

async function expandedText({ playwright }: Ctx): Promise<void> {
  const request = await playwright.request.newContext();
  await uploadVault(request, OWNER, [
    { rel: 'wiki/expanded.md', body: makeVaultMD({ publish: true }, 'Generated on 2026-07-06 by the owner.') },
  ]);
  const sess = await syncSession(request, OWNER);
  const body = (await syncRead(request, sess, 'expanded')).body ?? '';
  expect(body, 'plain expanded text ingested as-is').toContain('Generated on 2026-07-06');
  await request.dispose();
}
