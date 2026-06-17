// use-booking-email —— #122 约成卡"发确认邮件吗"那一截的状态机(逻辑层,组件只渲)。
//
// 收件人硬控:引用走 session email(send('')→后端拿 session 上的);透传走访客
// 现填地址。不发(skip)纯本地锁卡、不发请求。一笔一次:发出/已发(后端 409)都进
// sent 锁住。owner 没配 mail / 没 conversationID → visible=false,组件不渲。

'use client';

import { useCallback, useState } from 'react';

import { postBookingConfirmation, type BookingConfirmOutcome } from '@/lib/api/booking';
import { loadStoredSession } from '@/lib/gate/use-gate';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

export type BookingEmailPhase = 'idle' | 'sending' | 'sent';

export interface BookingEmailControl {
  visible: boolean;
  sessionEmail: string;
  phase: BookingEmailPhase;
  error: string | null;
  send: (email: string) => void;
  skip: () => void;
}

export function useBookingEmail(conversationID?: string): BookingEmailControl {
  const ownerCanEmail = useVisitorSessionStore((s) => s.session?.ownerCanEmail ?? false);
  const sessionEmail = useVisitorSessionStore((s) => s.session?.email ?? '');
  const [phase, setPhase] = useState<BookingEmailPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  const visible = ownerCanEmail && conversationID !== undefined && conversationID !== '';

  const send = useCallback((email: string): void => {
    void runSend(conversationID ?? '', email, setPhase, setError);
  }, [conversationID]);

  const skip = useCallback((): void => {
    setError(null);
    setPhase('sent');
  }, []);

  return { visible, sessionEmail, phase, error, send, skip };
}

const unavailableMsg = 'couldn’t send right now — try again later.';

async function runSend(
  conversationID: string, email: string,
  setPhase: (p: BookingEmailPhase) => void, setError: (e: string | null) => void,
): Promise<void> {
  const token = loadStoredSession()?.session_token ?? '';
  if (token === '') { setError(unavailableMsg); return; }
  setError(null);
  setPhase('sending');
  const outcome = await postBookingConfirmation(conversationID, email, token);
  applyOutcome(outcome, setPhase, setError);
}

// applyOutcome —— sent/already_sent 都锁卡(一笔一次);其余回 idle 给人话提示。
function applyOutcome(
  outcome: BookingConfirmOutcome,
  setPhase: (p: BookingEmailPhase) => void, setError: (e: string | null) => void,
): void {
  if (outcome === 'sent' || outcome === 'already_sent') { setPhase('sent'); return; }
  setPhase('idle');
  setError(messageFor(outcome));
}

function messageFor(outcome: BookingConfirmOutcome): string {
  if (outcome === 'no_recipient') return 'that doesn’t look like a valid email.';
  if (outcome === 'mail_unavailable') return 'email isn’t available right now.';
  return unavailableMsg;
}
