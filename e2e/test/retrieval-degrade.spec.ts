// retrieval-degrade.spec.ts —— D. Meili 挂 → 降级 + admin 健康显示 + 重试自愈(crawl face)。
//
// Postgres 是 source-of-truth,Meili 是可选加速层。挂了必须:
//   D1 搜索降级(退 PG 全文,不 500)   D2 写照落 DB(promote 不因 index 失败而失败)
//   D3 admin 面板显示 meili degraded   D4 恢复后重试补索引 → 写在 down 期间的条目变可搜 + admin 回 healthy
//
// 用 make meili-stop / meili-start 真停真起(不 bare docker)。e2e workers:1 串行;
// afterAll 保证重启 meili,不影响其他 spec。⚠️ 全 RED until 降级/健康/重试实现。

import { execSync } from 'node:child_process';
import path from 'node:path';

import { test, expect } from '@/fixtures/test';

import { seedWiki } from '@/fixtures/corpus';
import { search, searchTitles, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { issueSession } from '@/fixtures/visitor';

const REPO = path.resolve(__dirname, '../..');
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

function makeTarget(t: string): void {
  execSync(`make ${t}`, { cwd: REPO, stdio: 'ignore' });
}

// meiliHealthy —— 读 admin /system 的 health[] 里 name==='meili' 那条的 ok(undefined = 未列)。
async function meiliHealthy(req: import('@playwright/test').APIRequestContext): Promise<boolean | undefined> {
  const res = await req.get(`${BACKEND}/api/admin/system`);
  const body = await res.json() as { health?: { name: string; ok: boolean }[] };
  return body.health?.find((h) => h.name === 'meili')?.ok;
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
    makeTarget('meili-start'); // 无论如何恢复 meili
    await O.request.dispose();
  });

  async function sess() {
    return issueSession(O.request, { handle: O.handle, code: O.fullCode, visitor_name: 'V' });
  }

  test('D3 admin /system:meili 正常时 healthy', async () => {
    expect(await meiliHealthy(O.request), 'meili healthy when up').toBe(true);
  });

  test('D1/D2/D3 Meili 挂:搜索降级不 500、写照落、admin 显示 degraded', async () => {
    makeTarget('meili-stop');

    // D1 搜索降级(退 PG,不 500)—— 之前索引过的词仍搜得到
    const s = await sess();
    expect(await searchTitles(O.request, s, 'MIKEKW'), 'PG fallback still finds it').toContain('PreIndexed');

    // D2 写照落 DB —— promote 不因 index 失败而失败
    const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'WroteWhileDown', body: 'NOVEMBERKW written during outage', path: 'wrote-while-down',
    });
    expect(wikiID, 'write committed despite meili down').not.toBe('');

    // D3 admin 显示 degraded
    expect(await meiliHealthy(O.request), 'meili shown degraded').toBe(false);
  });

  test('D4 恢复 → 重试补索引:down 期间写的条目变可搜 + admin 回 healthy', async () => {
    makeTarget('meili-start');
    // 重试/reconcile 把 down 期间的写补进 index
    const s = await sess();
    await expect(async () => {
      expect(await searchTitles(O.request, s, 'NOVEMBERKW')).toContain('WroteWhileDown');
    }).toPass({ timeout: 15_000 });

    await expect(async () => {
      expect(await meiliHealthy(O.request), 'meili healthy after recovery').toBe(true);
    }).toPass({ timeout: 10_000 });
  });

  test('D-degrade search 不抛 500(纯健壮性)', async () => {
    const s = await sess();
    const hits = await search(O.request, s, 'anything'); // 不应抛
    expect(Array.isArray(hits)).toBe(true);
  });
});
