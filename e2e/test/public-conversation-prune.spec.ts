// public-conversation-prune.spec.ts —— codeless conversations can be cleaned up on a schedule the
// owner sets; conversations that came in on an access code are never touched.
//
// Public (and BYOAI) chat is open to anyone, so its conversation records can pile up without
// bound. The owner sets a cron + a retention in admin → conversations; a periodic job deletes
// codeless conversations idle longer than the retention. Default is OFF (empty cron).
//
// Both halves are asserted, so the test goes red on either failure:
//   • default off: an old public conversation survives a job run with no schedule set.
//   • scheduled: old public + old byoai go; a recent public one and an old CODE one stay. The code
//     one has code_id NULL on purpose — that is what a deleted code leaves behind (ON DELETE SET
//     NULL), and it must still count as coded.
//
// Old rows can't be made through any API, so they are inserted directly; the job is triggered the
// way it runs in production — the process starts (same as gas-usage-prune.spec.ts).

import { test, expect } from '@/fixtures/test';
import { claim } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'convprune@example.com', password: 'correct-horse-battery-staple',
  handle: 'convprune', fullName: 'Conv Prune Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('conversations · scheduled cleanup of codeless conversations', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('off by default; once scheduled, prunes old public/byoai and keeps coded + recent',
    async ({ adminPage: page }) => {
      test.setTimeout(180_000); // two backend restarts
      const ownerID = querySQL(`SELECT id FROM owners WHERE email = '${OWNER.email}'`);
      insertConv(ownerID, 'public', '10 days', 'old-public');

      // Default off: a job run with no schedule deletes nothing.
      restartBackend();
      expect(convCount('old-public'), 'no schedule set → nothing is pruned').toBe(1);

      insertConv(ownerID, 'byoai', '10 days', 'old-byoai');
      insertConv(ownerID, 'public', '1 day', 'recent-public');
      insertConv(ownerID, 'code', '10 days', 'old-code');

      // The owner sets the schedule in admin → conversations.
      await gotoAdminSection(page, 'conversations');
      await page.getByTestId('conv-prune-cron').fill('@daily');
      await page.getByTestId('conv-prune-days').fill('7');
      await page.getByTestId('conv-prune-save').click();
      await expect(page.getByTestId('conv-prune-status'), 'saved schedule is shown')
        .toContainText('@daily', { timeout: 10_000 });

      // The setting is real state, not form state: it reads back after a reload.
      await page.reload();
      await expect(page.getByTestId('conv-prune-cron')).toHaveValue('@daily', { timeout: 15_000 });
      await expect(page.getByTestId('conv-prune-days')).toHaveValue('7');

      // A daily schedule set just now isn't due until tomorrow; move the last run back so it is.
      execSQL(`UPDATE public_conversation_policy SET last_run_at = now() - interval '2 days'
               WHERE owner_id = '${ownerID}'`);
      restartBackend();

      expect(convCount('old-public'), 'old public conversation pruned').toBe(0);
      expect(convCount('old-byoai'), 'old byoai conversation pruned').toBe(0);
      expect(convCount('recent-public'), 'inside the retention window → kept').toBe(1);
      expect(convCount('old-code'), 'a coded conversation is never pruned').toBe(1);
    });
});

// insertConv —— one conversation idle for `age`. visitor_name doubles as the label each assertion
// names. code_id stays NULL for every row, including mode 'code' (see the header).
function insertConv(ownerID: string, mode: string, age: string, label: string): void {
  execSQL(
    `INSERT INTO conversations (owner_id, mode, visitor_name, started_at, last_at)
     VALUES ('${ownerID}', '${mode}', '${label}', now() - interval '${age}', now() - interval '${age}')`,
  );
}

function convCount(label: string): number {
  return Number(querySQL(`SELECT count(*) FROM conversations WHERE visitor_name = '${label}'`));
}
