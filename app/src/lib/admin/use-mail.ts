// use-mail —— mail (SMTP) connector state.
//
// Internally TWO zustand stores (mirroring the gcal connector), but consumers
// only ever touch ONE facade: useMail(). The stores are module-private so
// nobody can reach past the facade.
//
//   1. mailStatusStore —— the fetched connector status (createResourceStore:
//      one endpoint → one cached resource, like every other connector status).
//   2. useMailOTPStore —— the send-code → verify OTP *interaction* state
//      (code / msg / cooldown / sent). A bare zustand store, because the flow
//      isn't a fetched resource so the createResourceStore factory doesn't fit.
//
// The two coordinate via plain cross-store calls (same as gcal's authorize
// polling its status store): verifying flips connected, so it refreshes the
// status store; disconnecting resets the OTP flow.

'use client';

import { useEffect } from 'react';

import { z } from 'zod';
import { create, type StoreApi } from 'zustand';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// ─── status (fetched resource) ─────────────────────────────────

const MailStatusSchema = z.object({
  has_credentials: z.boolean(),
  connected: z.boolean(),
  host: z.string().optional(),
  from_address: z.string().optional(),
  from_name: z.string().optional(),
  port: z.number().optional(),
});
export type MailStatus = z.infer<typeof MailStatusSchema>;

// The real mail connector's canonical id is `smtp` (category `mail`), NOT `mail` —
// `/connectors/mail/status` resolves a dead id and always reports connected:false, so the
// requests approve-gate + account recovery-gate stayed locked even with a working, delivering
// SMTP connector (F-C-7). Derive `connected` from the authoritative connectors list instead:
// a `category:'mail'` connector that is connected and active.
const MailConnRowSchema = z.object({
  category: z.string(),
  has_credentials: z.boolean().nullish(),
  connected: z.boolean(),
  active: z.boolean().nullish(),
});
const ConnectorsListSchema = z.object({
  connectors: z.array(MailConnRowSchema).nullish(),
});

const mailStatusStore = createResourceStore<MailStatus>({
  name: 'mail-status',
  fetcher: async () => {
    const list = await adminAPI.get('/connectors', ConnectorsListSchema);
    const rows = (list.connectors ?? []).filter((c) => c.category === 'mail');
    const live = rows.find((c) => c.connected && (c.active ?? true));
    return MailStatusSchema.parse({
      connected: Boolean(live),
      has_credentials: rows.some((c) => c.has_credentials ?? false),
    });
  },
});

export interface MailCredsInput {
  host: string;
  port: number;
  username: string;
  password: string;
  from_address: string;
  from_name: string;
}

interface MailTestResult {
  ok: boolean;
  error?: string;
}

// ─── facade ────────────────────────────────────────────────────
// MailHook is the single object every consumer uses. status + creds/disconnect
// come from the status store; `otp` is the verify-flow slice from the OTP store.

export interface MailOTPView {
  code: string;
  msg: string | null;
  cooldown: number;
  sent: boolean;
  setCode: (v: string) => void;
  send: () => Promise<void>;
  verify: () => Promise<void>;
}

export interface MailHook {
  statusKind: ResourceStatus;
  status: MailStatus | null;
  error: string | null;
  saveCredentials: (input: MailCredsInput) => Promise<void>;
  disconnect: () => Promise<void>;
  otp: MailOTPView;
}

export function useMail(): MailHook {
  const r = useResource(mailStatusStore);
  const otp = useMailOTPStore();
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    statusKind: r.status,
    status: r.data ?? null,
    error: r.error,
    saveCredentials,
    disconnect,
    otp: {
      code: otp.code, msg: otp.msg, cooldown: otp.cooldown, sent: otp.sent,
      setCode: otp.setCode, send: otp.send, verify: otp.verify,
    },
  };
}

// mutation 抛错（不再吞成 false）：auto-save 的 saveCredentials 用 `.catch(report)`，
// 显式按钮 disconnect 用 useAction 收尾。
async function saveCredentials(input: MailCredsInput): Promise<void> {
  await adminAPI.postVoid('/connectors/mail/credentials', input);
  await mailStatusStore.getState().refresh();
}

async function disconnect(): Promise<void> {
  await adminAPI.postVoid('/connectors/mail/disconnect', {});
  await mailStatusStore.getState().refresh();
  useMailOTPStore.getState().reset(); // clear any pending code + cooldown
}

// ─── OTP verify flow (interaction state) ───────────────────────

// MAIL_OTP_COOLDOWN_SECS —— must match backend domain.MailOTPResendCooldown; the
// resend button is disabled for this long after a send (email-bomb guard,
// mirrored client-side so the user sees the countdown).
const MAIL_OTP_COOLDOWN_SECS = 30;

interface MailOTPStore {
  code: string;
  msg: string | null;
  cooldown: number;
  sent: boolean;
  setCode: (v: string) => void;
  send: () => Promise<void>;
  verify: () => Promise<void>;
  reset: () => void;
}

type OTPSet = StoreApi<MailOTPStore>['setState'];
type OTPGet = StoreApi<MailOTPStore>['getState'];

// cooldown ticks on a module-level interval so it survives navigating away +
// back (the backend 429 is the real guard; this just mirrors the countdown).
let mailCooldownTimer: ReturnType<typeof setInterval> | null = null;

const useMailOTPStore = create<MailOTPStore>((set, get) => ({
  code: '',
  msg: null,
  cooldown: 0,
  sent: false,
  setCode: (code) => set({ code }),
  send: async () => {
    set({ msg: 'sending…' });
    applySendResult(set, get, await sendOTP());
  },
  verify: async () => {
    set({ msg: 'verifying…' });
    const r = await verifyOTP(get().code);
    if (!r.ok) { set({ msg: r.error ?? 'verification failed' }); return; }
    await mailStatusStore.getState().refresh(); // flips connected → ConnectedRow
    resetOTP(set);
  },
  reset: () => resetOTP(set),
}));

function applySendResult(set: OTPSet, get: OTPGet, r: MailTestResult): void {
  if (!r.ok) { set({ msg: r.error ?? 'could not send the code' }); return; }
  set({ msg: 'code sent — check your inbox', sent: true });
  startCooldown(set, get);
}

function startCooldown(set: OTPSet, get: OTPGet): void {
  stopCooldown();
  set({ cooldown: MAIL_OTP_COOLDOWN_SECS });
  mailCooldownTimer = setInterval(() => {
    const next = get().cooldown - 1;
    set({ cooldown: next });
    if (next <= 0) stopCooldown();
  }, 1000);
}

function stopCooldown(): void {
  if (mailCooldownTimer !== null) {
    clearInterval(mailCooldownTimer);
    mailCooldownTimer = null;
  }
}

function resetOTP(set: OTPSet): void {
  stopCooldown();
  set({ code: '', msg: null, cooldown: 0, sent: false });
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

