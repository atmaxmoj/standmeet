// account-form —— pure-function helpers for the /admin/account form: disable
// computation + inline hint copy. Split out of AccountSection.tsx because the
// presentation layer must not contain `if` chains + cyclo > 3.

export function fullNameSaveDisabled(
  pending: boolean, raw: string, initial: string,
): boolean {
  const trimmed = raw.trim();
  return pending || trimmed === '' || trimmed === initial;
}

// emailSaveDisabled —— changing the email requires typing it twice.
//
// Changing the password already requires two entries (`account-password-confirm`),
// but the equally dangerous email change on the same panel did not require it —
// that inconsistency was itself a defect. The email column is both **sign-in
// identity** and **recovery channel** (recovery reads it directly as the
// recipient); one typo removes both the key and the spare key, and since
// sessions are keyed by ownerID, the owner feels nothing at the time.
//
// When SMTP is configured, the backend also sends a confirmation email (identity
// does not move until the link is clicked); this double entry is the **only**
// protection when there is no SMTP, so both paths stay in place.
export function emailSaveDisabled(
  pending: boolean, current: string, next: string, confirm: string, initial: string,
): boolean {
  return pending || isAnyBlank(current, next, confirm)
    || next !== confirm || next === initial;
}

// emailHintMessage —— speaks up when the two entries don't match. Returns a message
// KEY (resolved via t() in the component) or '' when there's nothing to say yet.
export function emailHintMessage(next: string, confirm: string): string {
  return confirm === '' || next === confirm ? '' : 'emailMismatch';
}

export function passwordSaveDisabled(
  pending: boolean, current: string, next: string, confirm: string,
): boolean {
  return pending || current === '' || !passwordPairValid(next, confirm);
}

// passwordHintMessage —— returns a message KEY (resolved via t() in the component) or ''.
export function passwordHintMessage(next: string, confirm: string): string {
  return next === ''
    ? ''
    : next.length < 12
      ? 'pwTooShort'
      : confirm !== '' && next !== confirm
        ? 'pwMismatch'
        : '';
}

export interface RecoveryRowView {
  detailKey: string;
  noteKey: string;
}

// recoveryRowView —— display data for the recovery phrase row. Recovery is sent by
// email, so it needs a verified SMTP supplier first (#112/#122's mail-sender is
// that supplier); unverified → greyed state + prompt to configure Suppliers.
//
// Warning: this copy used to say the opposite thing: it read "generation not
// built yet", while the `/account/recovery` and `/recover` routes were
// **already implemented** (routes/admin/account.go:33 + claim.go:74,
// recovery-phrase.spec.ts runs). A backwards message like that kept the owner
// from using the one feature that could save them — and after a typo in the
// email, the recovery phrase is exactly that escape route ([[names-that-lie]]).
// Before changing this line, confirm the button-side behavior first — don't let
// the copy and the code diverge again.
export function recoveryRowView(mailConnected: boolean): RecoveryRowView {
  return mailConnected
    ? { detailKey: 'recoveryDetailReady', noteKey: 'recoveryNoteReady' }
    : { detailKey: 'recoveryDetailNeedsMail', noteKey: 'recoveryNoteNeedsMail' };
}

function isAnyBlank(...vals: string[]): boolean {
  return vals.some((v) => v === '');
}

function passwordPairValid(next: string, confirm: string): boolean {
  return next.length >= 12 && next === confirm;
}
