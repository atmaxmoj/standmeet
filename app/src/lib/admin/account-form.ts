// account-form —— /admin/account 表单的纯函数 helper：disable 计算 +
// inline hint 文案。从 AccountSection.tsx 拆出来，presentation 层不能
// 出现 `if` 链 + cyclo > 3。

export function fullNameSaveDisabled(
  pending: boolean, raw: string, initial: string,
): boolean {
  const trimmed = raw.trim();
  return pending || trimmed === '' || trimmed === initial;
}

// emailSaveDisabled —— 改邮箱要输两遍。
//
// 改密码早就要求输两遍（`account-password-confirm`），而同一个面板上同等危险的改邮箱
// 不要求 —— 那个不一致本身就是缺陷。email 这一列同时是**登录身份**和**恢复渠道**
// （recovery 的收件人直接读它），一个拼写错误同时拿掉钥匙和备用钥匙，而 session 按
// ownerID 发，owner 当场毫无感觉。
//
// 有 SMTP 时后端还会走确认信（身份不动直到点开链接）；这道双录入是**没有 SMTP 时**
// 唯一的保护，两条路都留着。
export function emailSaveDisabled(
  pending: boolean, current: string, next: string, confirm: string, initial: string,
): boolean {
  return pending || isAnyBlank(current, next, confirm)
    || next !== confirm || next === initial;
}

// emailHintMessage —— 两遍不一致时说出来。空串 = 没话说（还没输够）。
export function emailHintMessage(next: string, confirm: string): string {
  return confirm === '' || next === confirm ? '' : 'the two addresses do not match';
}

// pendingEmailNote —— 待确认那一行的文案。owner 必须知道：**身份还没动**。
export function pendingEmailNote(pending: string): string {
  return `Waiting for ${pending} to confirm. Until it does, your sign-in and your `
    + 'recovery phrase both stay on the current address.';
}

export function passwordSaveDisabled(
  pending: boolean, current: string, next: string, confirm: string,
): boolean {
  return pending || current === '' || !passwordPairValid(next, confirm);
}

export function passwordHintMessage(next: string, confirm: string): string {
  return next === ''
    ? ''
    : next.length < 12
      ? 'new password must be at least 12 characters'
      : confirm !== '' && next !== confirm
        ? 'new password and confirm do not match'
        : '';
}

export interface RecoveryRowView {
  detail: string;
  note: string;
}

// recoveryRowView —— recovery phrase 行的展示数据。recovery 靠邮件发送，需先有已验证的 SMTP
// connector(#112/#122 的 mail-sender 就是它)；未验证 → 灰态 + 引导去 Connectors 配。
//
// ⚠️ 这里的话曾经说反：它写着「generation not built yet」，而 `/account/recovery` 和
// `/recover` 两条路由**早就实现了**（routes/admin/account.go:33 + claim.go:74，
// recovery-phrase.spec.ts 在跑）。一句说反话的说明，让 owner 不去用唯一能救他的功能 ——
// 而改邮箱打错字之后，恢复短语正是那条退路（[[names-that-lie]]）。
// 改这行之前先确认按钮那一侧的行为，别再让文案和代码各说各的。
export function recoveryRowView(mailConnected: boolean): RecoveryRowView {
  return mailConnected
    ? {
        detail: 'not yet set',
        note: 'Generates a recovery phrase and emails it to you. Single use — it is consumed when you sign in with it.',
      }
    : {
        detail: 'needs verified email',
        note: 'Verify email (SMTP) under Connectors first — the recovery phrase is sent to you by email.',
      };
}

function isAnyBlank(...vals: string[]): boolean {
  return vals.some((v) => v === '');
}

function passwordPairValid(next: string, confirm: string): boolean {
  return next.length >= 12 && next === confirm;
}
