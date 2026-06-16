// use-mail —— state + actions for the /admin/connectors Mail (SMTP) panel.
//
// 一块状态:connector status (has_credentials / connected / host / from)。
// saveCredentials 存配置;sendOTP 真发一封 6 位码到 from_address;verifyOTP 码对了
// backend 才标 connected;disconnect 删配置。所有改 connected 的 mutation 立即
// refresh status store。

'use client';

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
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

export const mailStatusStore = createResourceStore<MailStatus>({
  name: 'mail-status',
  fetcher: () => adminAPI.get('/connectors/mail/status', MailStatusSchema),
});

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

export interface MailHook {
  statusKind: ResourceStatus;
  status: MailStatus | null;
  error: string | null;
  saveCredentials: (input: MailCredsInput) => Promise<boolean>;
  sendOTP: () => Promise<MailTestResult>;
  verifyOTP: (code: string) => Promise<MailTestResult>;
  disconnect: () => Promise<boolean>;
}

export function useMail(): MailHook {
  const r = readResource(mailStatusStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    statusKind: r.status,
    status: r.data ?? null,
    error: r.error,
    saveCredentials,
    sendOTP,
    verifyOTP,
    disconnect,
  };
}

async function saveCredentials(input: MailCredsInput): Promise<boolean> {
  try {
    await adminAPI.postVoid('/connectors/mail/credentials', input);
    await mailStatusStore.getState().refresh();
    return true;
  } catch {
    return false;
  }
}

// MAIL_OTP_COOLDOWN_SECS —— must match backend domain.MailOTPResendCooldown; the
// resend button is disabled for this long after a send (email-bomb guard, mirrored
// client-side so the user sees the countdown).
export const MAIL_OTP_COOLDOWN_SECS = 30;

export interface MailOTPFlow {
  code: string;
  setCode: (v: string) => void;
  msg: string | null;
  cooldown: number;
  sent: boolean;
  send: () => Promise<void>;
  verify: () => Promise<void>;
}

// useMailOTPFlow —— the send-code → enter-code → verify interaction state. Keeps
// the panel a pure renderer; the cooldown countdown + send/verify live here.
export function useMailOTPFlow(hook: MailHook): MailOTPFlow {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const send = useCallback(async () => {
    setMsg('sending…');
    const r = await hook.sendOTP();
    setMsg(r.ok ? 'code sent — check your inbox' : (r.error ?? 'could not send the code'));
    r.ok && setSent(true);
    r.ok && setCooldown(MAIL_OTP_COOLDOWN_SECS);
  }, [hook]);
  const verify = useCallback(async () => {
    setMsg('verifying…');
    const r = await hook.verifyOTP(code);
    setMsg(r.ok ? 'verified ✓' : (r.error ?? 'verification failed'));
  }, [hook, code]);
  return { code, setCode, msg, cooldown, sent, send, verify };
}

// sendCodeLabel —— button copy: cooldown countdown → 'Resend' once sent → 'Send'.
export function sendCodeLabel(cooldown: number, sent: boolean): string {
  return cooldown > 0 ? `Resend in ${cooldown}s` : sent ? 'Resend code →' : 'Send code →';
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
    await mailStatusStore.getState().refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Verification failed' };
  }
}

async function disconnect(): Promise<boolean> {
  try {
    await adminAPI.postVoid('/connectors/mail/disconnect', {});
    await mailStatusStore.getState().refresh();
    return true;
  } catch {
    return false;
  }
}
