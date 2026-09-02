// visitor-name.ts —— visibility logic for VisitorNamePicker.
//
// The defer-issue model: scanning a code pulls it into the pending store
// (a session isn't issued yet). As long as there's a pending code, the name
// picker pops up; once the visitor submits a name (or skips),
// use-issue-pending-code actually calls issueCodeSession, pending gets
// consumed → auto-hides.
//
// During SSR the pending store's code is null → doesn't pop up (no
// hydration mismatch).

import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';

// useShouldAskVisitorName —— pops up whenever there's a pending code
// (scanned in but hasn't picked a name and started the session yet).
export function useShouldAskVisitorName(): boolean {
  return usePendingCodeStore((s) => s.code !== null);
}

// VISITOR_NAME_KEY —— the last name used. Under defer-issue the name
// picker pops up every time a code is scanned, but the same person (same
// browser) shouldn't have to retype their name each time → save one and
// auto-load it into the input.
const VISITOR_NAME_KEY = 'standmeet-visitor-name';
// VISITOR_EMAIL_KEY —— same idea: the optional email is also saved, so a
// returning visitor doesn't have to retype it (#121).
const VISITOR_EMAIL_KEY = 'standmeet-visitor-email';

// loadVisitorName —— reads the last saved name (to prefill the name
// picker); none → empty string.
export function loadVisitorName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(VISITOR_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

// loadVisitorEmail —— reads the last saved optional email (to prefill);
// none → empty string.
export function loadVisitorEmail(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(VISITOR_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

// rememberVisitorEmail —— saves the optional email on submit, auto-loaded
// next time.
export function rememberVisitorEmail(email: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VISITOR_EMAIL_KEY, email);
  } catch {
    // localStorage full / unavailable → silent.
  }
}

// rememberVisitorName —— saves the name on submit, auto-loaded next time.
export function rememberVisitorName(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VISITOR_NAME_KEY, name);
  } catch {
    // localStorage full / unavailable → silent.
  }
}

// VISITOR_MEMBER_ID_KEY —— the last member id received. An anonymous
// (skip) visitor uses it to continue their session, so they don't collapse
// into some other anonymous visitor; the backend validates on (member_id,
// code), auto-invalidating across codes.
const VISITOR_MEMBER_ID_KEY = 'standmeet-visitor-member-id';

export function loadMemberID(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(VISITOR_MEMBER_ID_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberMemberID(memberID: string): void {
  if (typeof window === 'undefined' || memberID === '') return;
  try {
    window.localStorage.setItem(VISITOR_MEMBER_ID_KEY, memberID);
  } catch {
    // localStorage full / unavailable → silent.
  }
}

// clearNameDismiss —— the old 30-day dismiss mechanism is no longer needed
// under the defer-issue model (consuming the pending code already handles
// hiding it). Kept as a no-op so absorb callers stay compatible.
export function clearNameDismiss(): void {
  // no-op (kept so use-absorb-code doesn't need to change its import)
}
