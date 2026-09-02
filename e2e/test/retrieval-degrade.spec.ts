// retrieval-degrade.spec.ts — D. Meili goes down → degrades gracefully + admin health shows it +
// retry self-heals (the crawl face).
//
// Postgres is the source of truth; Meili is an optional acceleration layer. When it's down:
//   D1 search degrades (falls back to PG full-text, no 500)   D2 writes still land in the DB
//   (promote doesn't fail just because indexing failed)
//   D3 the admin panel shows meili degraded   D4 after recovery, a retry backfills the index →
//   entries written during the outage become searchable + admin goes back to healthy
//
// Uses make meili-stop / meili-start for a real stop/start (not bare docker). e2e workers:1
// serial; afterAll guarantees meili gets restarted, so other specs aren't affected.
// ⚠️ Everything here is RED until degradation/health/retry are implemented.

import { execSync } from 'node:child_process';
import path from 'node:path';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { seedWiki } from '@/fixtures/corpus';
import { search, searchTitles, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';

const REPO = path.resolve(__dirname, '../..');
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

function makeTarget(t: string): void {
  execSync(`make ${t}`, { cwd: REPO, stdio: 'ignore' });
}

// searchHealthy — reads the `ok` field of the retrieval entry inside admin /system's health[].
//
// **That entry is named `search`, not `meili`, and it must always be present in the table now**
// (F-S-3). Before the rename it was written as `meili` and got "left out of the list when
// unconfigured," so this function used to return undefined — and undefined here is a different
// thing from "the engine is down," even though the two look similar. Now, absence itself is a
// defect, so undefined is no longer a legitimate state: failing to fetch this row must go red.
async function searchHealthy(req: APIRequestContext): Promise<boolean> {
  const res = await req.get(`${BACKEND}/api/admin/system`);
  const body = await res.json() as { health?: { name: string; ok: boolean }[] };
  const row = body.health?.find((h) => h.name === 'search');
  expect(row, 'the health table always carries a search row (F-S-3)').toBeDefined();
  return row?.ok ?? false;
}

let O: RetrievalOwner;

test.describe.serial('D · Meili 降级 / 健康 / 重试', () => {
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'degrade');
    await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'PreIndexed', body: 'MIKEKW indexed before outage', path: 'pre-indexed',
    });
  });
  test.afterAll(async () => {
    makeTarget('meili-start'); // restore meili no matter what
    await O.request.dispose();
  });

  async function sess() {
    return issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'V' });
  }

  test('D3 admin /system:meili 正常时 healthy', async () => {
    expect(await searchHealthy(O.request), 'meili healthy when up').toBe(true);
  });

  test('D1/D2/D3 Meili 挂:搜索降级不 500、写照落、admin 显示 degraded', async () => {
    makeTarget('meili-stop');

    // D1 search degrades (falls back to PG, no 500) — a term indexed before the outage is still
    // findable
    const s = await sess();
    expect(await searchTitles(O.request, s, 'MIKEKW'), 'PG fallback still finds it').toContain('PreIndexed');

    // D2 writes still land in the DB — promote doesn't fail just because indexing failed
    const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'WroteWhileDown', body: 'NOVEMBERKW written during outage', path: 'wrote-while-down',
    });
    expect(wikiID, 'write committed despite meili down').not.toBe('');

    // D3 admin shows degraded
    expect(await searchHealthy(O.request), 'meili shown degraded').toBe(false);
  });

  test('D4 恢复 → 重试补索引:down 期间写的条目变可搜 + admin 回 healthy', async () => {
    makeTarget('meili-start');
    // retry/reconcile backfills writes made during the outage into the index
    const s = await sess();
    await expect(async () => {
      expect(await searchTitles(O.request, s, 'NOVEMBERKW')).toContain('WroteWhileDown');
    }).toPass({ timeout: 15_000 });

    await expect(async () => {
      expect(await searchHealthy(O.request), 'meili healthy after recovery').toBe(true);
    }).toPass({ timeout: 10_000 });
  });

  test('D-degrade search 不抛 500(纯健壮性)', async () => {
    const s = await sess();
    const hits = await search(O.request, s, 'anything'); // must not throw
    expect(Array.isArray(hits)).toBe(true);
  });
});
