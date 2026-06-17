// visitor-name.ts —— VisitorNamePicker 的可见性逻辑。
//
// defer-issue 模型:扫码把 code 吸进 pending store(还没 issue session)。只要
// 有 pending code 就弹名字选择器;visitor 提交名字(或 skip)后由
// use-issue-pending-code 真正 issueCodeSession,pending 被 consume → 自动隐藏。
//
// SSR 时 pending store 的 code 是 null → 不弹(无 hydration mismatch)。

import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';

// useShouldAskVisitorName —— 有 pending code(扫码进来还没选名字开会)就弹。
export function useShouldAskVisitorName(): boolean {
  return usePendingCodeStore((s) => s.code !== null);
}

// VISITOR_NAME_KEY —— 上次用的名字。defer-issue 下名字选择器每次扫码都弹,
// 但同一个人(同浏览器)不该每次重打名字 → 存一份,再开自动 load 进输入框。
const VISITOR_NAME_KEY = 'standmeet-visitor-name';
// VISITOR_EMAIL_KEY —— 同理:可选邮箱也存一份,返回访客不用重打(#121)。
const VISITOR_EMAIL_KEY = 'standmeet-visitor-email';

// loadVisitorName —— 读上次存的名字(给名字选择器预填);没有 → 空串。
export function loadVisitorName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(VISITOR_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

// loadVisitorEmail —— 读上次存的可选邮箱(预填);没有 → 空串。
export function loadVisitorEmail(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(VISITOR_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

// rememberVisitorEmail —— 提交时存下可选邮箱,下次自动 load。
export function rememberVisitorEmail(email: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VISITOR_EMAIL_KEY, email);
  } catch {
    // LS 满 / 不可用 → silent。
  }
}

// rememberVisitorName —— 提交名字时存下来,下次自动 load。
export function rememberVisitorName(name: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VISITOR_NAME_KEY, name);
  } catch {
    // LS 满 / 不可用 → silent。
  }
}

// VISITOR_MEMBER_ID_KEY —— 上次拿到的 member id。匿名(skip)访客凭它续会,不会
// 跟别的匿名者塌成一个;后端按 (member_id, code) 校验,跨码自动失效。
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
    // LS 满 / 不可用 → silent。
  }
}

// clearNameDismiss —— 旧的 30 天 dismiss 机制在 defer-issue 模型下不再需要
// (pending code 的 consume 就负责隐藏)。保留一个 no-op 兼容 absorb 调用方。
export function clearNameDismiss(): void {
  // no-op (kept so use-absorb-code 不用改 import)
}
