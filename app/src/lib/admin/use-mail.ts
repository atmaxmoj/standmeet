// use-mail —— 整个 mail (SMTP) connector 的状态都在一个 zustand store 里。
//
// 一处管两类状态:
//   1. 从后端拉的 connector status (has_credentials / connected / host / from)。
//   2. send-code → 输码 → verify 这套 OTP 交互态 (code / msg / cooldown / sent)。
// 放一个 store —— verify 成功要就地翻 connected、disconnect 要顺手清掉 OTP flow +
// 倒计时,两类状态本就耦合。useMail() 是给只关心 status 的地方用的薄 selector;
// 面板的 OTP 流程直接订阅 useMailStore。

'use client';

import { useEffect } from 'react';

import { z } from 'zod';
import { create, type StoreApi } from 'zustand';

import { adminAPI } from '@/lib/api/admin';
import { logger } from '@/lib/logger';
import type { ResourceStatus } from '@/lib/state/status';

export const MailStatusSchema = z.object({
  has_credentials: z.boolean(),
  connected: z.boolean(),
  host: z.string().optional(),
  from_address: z.string().optional(),
  from_name: z.string().optional(),
  port: z.number().optional(),
});
export type MailStatus = z.infer<typeof MailStatusSchema>;

export interface MailCredsInput {
  host: string;
  port: number;
  username: string;
  password: string;
  from_address: string;
  from_name: string;
}

export interface MailTestResult {
  ok: boolean;
  error?: string;
}

// MAIL_OTP_COOLDOWN_SECS —— must match backend domain.MailOTPResendCooldown; the
// resend button is disabled for this long after a send (email-bomb guard, mirrored
// client-side so the user sees the countdown).
export const MAIL_OTP_COOLDOWN_SECS = 30;

// MailState —— 整个 mail connector 的状态:fetched status + OTP 交互态 + 全部 action。
export interface MailState {
  // —— fetched connector status ——
  status: MailStatus | null;
  statusKind: ResourceStatus;
  error: string | null;
  // —— OTP verify flow ——
  code: string;
  msg: string | null;
  cooldown: number;
  sent: boolean;
  // —— actions ——
  ensureLoaded: () => Promise<void>;
  refresh: () => Promise<void>;
  saveCredentials: (input: MailCredsInput) => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  setCode: (v: string) => void;
  sendCode: () => Promise<void>;
  verifyCode: () => Promise<void>;
  resetFlow: () => void;
}

type MailSet = StoreApi<MailState>['setState'];
type MailGet = StoreApi<MailState>['getState'];

// 倒计时跑在模块级 interval 上,所以离开面板再回来,倒计时还在(后端 429 才是真
// 防 email-bomb 的闸,这里只镜像让用户看到读秒)。
let mailCooldownTimer: ReturnType<typeof setInterval> | null = null;

export const useMailStore = create<MailState>((set, get) => ({
  status: null,
  statusKind: 'idle',
  error: null,
  code: '',
  msg: null,
  cooldown: 0,
  sent: false,

  ensureLoaded: async () => {
    if (get().statusKind !== 'idle') return;
    await fetchMailStatus(set);
  },
  refresh: async () => { await fetchMailStatus(set); },

  saveCredentials: async (input) =>
    mutateThenRefresh(set, () => adminAPI.postVoid('/connectors/mail/credentials', input)),

  disconnect: async () => {
    const ok = await mutateThenRefresh(set,
      () => adminAPI.postVoid('/connectors/mail/disconnect', {}));
    if (ok) resetFlowState(set);
    return ok;
  },

  setCode: (code) => set({ code }),

  sendCode: async () => {
    set({ msg: 'sending…' });
    applySendResult(set, get, await sendOTP());
  },

  verifyCode: async () => {
    set({ msg: 'verifying…' });
    const r = await verifyOTP(get().code);
    if (!r.ok) { set({ msg: r.error ?? 'verification failed' }); return; }
    await fetchMailStatus(set); // flips connected → panel switches to ConnectedRow
    resetFlowState(set);
  },

  resetFlow: () => resetFlowState(set),
}));

// MailHook —— useMail() 的返回:给只关心 connector status 的地方用(account / requests
// 看 connected;面板的 cred 表单 + disconnect 按钮)。OTP flow 直接订阅 useMailStore。
export interface MailHook {
  statusKind: ResourceStatus;
  status: MailStatus | null;
  error: string | null;
  saveCredentials: (input: MailCredsInput) => Promise<boolean>;
  disconnect: () => Promise<boolean>;
}

export function useMail(): MailHook {
  const statusKind = useMailStore((s) => s.statusKind);
  const status = useMailStore((s) => s.status);
  const error = useMailStore((s) => s.error);
  const saveCredentials = useMailStore((s) => s.saveCredentials);
  const disconnect = useMailStore((s) => s.disconnect);
  const ensureLoaded = useMailStore((s) => s.ensureLoaded);
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { statusKind, status, error, saveCredentials, disconnect };
}

// sendCodeLabel —— button copy: cooldown countdown → 'Resend' once sent → 'Send'.
export function sendCodeLabel(cooldown: number, sent: boolean): string {
  return cooldown > 0 ? `Resend in ${cooldown}s` : sent ? 'Resend code →' : 'Send code →';
}

// mailActionsView —— which connector controls to show: nothing (no creds), the
// verify flow (configured but unverified), or just disconnect (verified).
export function mailActionsView(status: MailStatus | null): 'none' | 'verify' | 'connected' {
  if (status?.has_credentials !== true) return 'none';
  return status.connected ? 'connected' : 'verify';
}

// ─── internals ────────────────────────────────────────────────

async function fetchMailStatus(set: MailSet): Promise<void> {
  set({ statusKind: 'loading', error: null });
  try {
    const data = await adminAPI.get('/connectors/mail/status', MailStatusSchema);
    set({ status: data, statusKind: 'ready', error: null });
  } catch (e) {
    logger.error('store mail: status fetch', e);
    set({ statusKind: 'error', error: e instanceof Error ? e.message : 'load failed' });
  }
}

// mutateThenRefresh —— run a write, then re-pull status so connected/has_credentials
// reflect it. Returns false (without throwing) if the write failed.
async function mutateThenRefresh(set: MailSet, run: () => Promise<void>): Promise<boolean> {
  try {
    await run();
  } catch {
    return false;
  }
  await fetchMailStatus(set);
  return true;
}

async function sendOTP(): Promise<MailTestResult> {
  try {
    await adminAPI.postVoid('/connectors/mail/send-otp', {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not send the code' };
  }
}

async function verifyOTP(code: string): Promise<MailTestResult> {
  try {
    await adminAPI.postVoid('/connectors/mail/verify-otp', { code });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Verification failed' };
  }
}

function applySendResult(set: MailSet, get: MailGet, r: MailTestResult): void {
  if (!r.ok) { set({ msg: r.error ?? 'could not send the code' }); return; }
  set({ msg: 'code sent — check your inbox', sent: true });
  startMailCooldown(set, get);
}

function startMailCooldown(set: MailSet, get: MailGet): void {
  stopMailCooldown();
  set({ cooldown: MAIL_OTP_COOLDOWN_SECS });
  mailCooldownTimer = setInterval(() => {
    const next = get().cooldown - 1;
    set({ cooldown: next });
    if (next <= 0) stopMailCooldown();
  }, 1000);
}

function stopMailCooldown(): void {
  if (mailCooldownTimer !== null) {
    clearInterval(mailCooldownTimer);
    mailCooldownTimer = null;
  }
}

function resetFlowState(set: MailSet): void {
  stopMailCooldown();
  set({ code: '', msg: null, cooldown: 0, sent: false });
}
