// account-recovery-row-tells-the-truth.spec.ts —— 按钮能用，旁边却写着"还没做"。
//
// 缺陷（审计 2026-08-31 查覆盖时翻出来的）：`lib/admin/account-form.ts` 的 `recoveryRowView`
// 在 mail connector 已验证时返回
//
//     note: 'Generates a recovery phrase emailed to you (generation not built yet).'
//
// 而这个功能**是做完的** —— `routes/admin/account.go:33` 挂着 `POST /account/recovery`，
// `routes/admin/claim.go:74` 挂着 `POST /recover`，`recovery-phrase.spec.ts` 在跑没被跳过，
// `AccountSection.tsx:98` 那个按钮真的会 POST 出去并且 toast 成功。
//
// 这是 [[names-that-lie]] 那一族：一句给 owner 看的话，断言了一件跟产品实际行为相反的事。
// 后果不是"文案不好看"—— 是 owner **不会去用一个能救他的功能**。而这个功能恰好是
// 改邮箱打错字之后唯一的退路，跟 pending-email 那一串是同一个故事的两半。
//
// 判据成对：先证明它**真的能生成并寄出**（正对照），再断那句话没在说反话。
// 只断文案的话，哪天功能真坏了，这条测试还是绿的。

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { clearMailpit, configureMailConnector, waitForMailTo } from '@/fixtures/mail';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'truthful@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'truthful',
  fullName: 'Tess Truthful',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('account · the recovery row describes what the button actually does', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await clearMailpit(request);
    await request.dispose();
  });

  // ── 正对照：它真的能用 ──────────────────────────────────────────
  test('with a verified mail connector, generate actually sends a phrase to the owner',
    async ({ adminPage: page, playwright }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });

      const btn = page.getByTestId('recovery-generate');
      await expect(btn).toBeEnabled();
      await btn.click();

      // 回执去外部收件箱验，不看产品自己说"已发送"
      // （[[receipt-check-belongs-next-to-the-action]]）。
      const request = await playwright.request.newContext();
      const body = await waitForMailTo(request, OWNER.email);
      expect(body.length).toBeGreaterThan(0);
      await request.dispose();
    });

  // ── 有了正对照，文案那半边才有意义 ──────────────────────────────
  test('the row does not tell the owner the feature is unbuilt',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });
      // 那句说明住在 InfoDot 的 tooltip 和按钮的 title 里，取文本取不到 —— 读属性。
      // （[[negated-assertion-passes-while-absent]]：先把值取出来再判，别对着可能不存在的
      //   元素写 .not.toContainText。）
      const note = await page.getByTestId('recovery-generate').getAttribute('title');
      expect(note, 'recovery 行没有说明文字').not.toBeNull();
      // 一句说反话的说明，让 owner 不去用唯一能救他的功能。
      expect(note!).not.toMatch(/not built|coming soon|not yet implemented/i);
      // 而且它得说清这东西**是什么**，否则删掉那句谎话只是留下一片空白。
      expect(note!).toMatch(/recovery phrase|emails it to you/i);
      await expect(page.getByTestId('recovery-row')).toContainText(/recovery phrase/i);
    });

  // ── 没有 mail connector 时那句话也得是真的 ──────────────────────
  test('without a mail connector the row explains the gate, and the button is off',
    async ({ adminPage: page, playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      // 拆掉 mail connector：灰态那句话说的是"缺 SMTP"，不该也说"没做"。
      await request.delete(`${process.env['BACKEND_URL'] ?? 'http://localhost:8000'}` +
        `/api/admin/connectors/mail-sender/credentials`, { headers: { 'X-Csrftoken': csrf } });
      await request.dispose();

      await gotoAdminSection(page, 'account');
      await page.waitForURL('**/admin/account', { timeout: 5_000 });
      const note = await page.getByTestId('recovery-generate').getAttribute('title');
      expect(note, '灰态也得有说明').not.toBeNull();
      // 灰态那句话说的是"缺 SMTP"，不该也说"没做"。
      expect(note!).toMatch(/verif|email|smtp/i);
      expect(note!).not.toMatch(/not built|coming soon/i);
      await expect(page.getByTestId('recovery-generate')).toBeDisabled();
    });
});
