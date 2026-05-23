// account-form —— /admin/account 表单的纯函数 helper：disable 计算 +
// inline hint 文案。从 AccountSection.tsx 拆出来，presentation 层不能
// 出现 `if` 链 + cyclo > 3。

export function fullNameSaveDisabled(
  pending: boolean, raw: string, initial: string,
): boolean {
  const trimmed = raw.trim();
  return pending || trimmed === '' || trimmed === initial;
}

export function emailSaveDisabled(
  pending: boolean, current: string, next: string, initial: string,
): boolean {
  return pending || isAnyBlank(current, next) || next === initial;
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

function isAnyBlank(...vals: string[]): boolean {
  return vals.some((v) => v === '');
}

function passwordPairValid(next: string, confirm: string): boolean {
  return next.length >= 12 && next === confirm;
}
