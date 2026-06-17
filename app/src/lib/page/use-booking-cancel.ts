// use-booking-cancel —— #123 BookCard 上"取消会议"按钮的状态机(逻辑层,组件只渲)。
//
// 只传 event_id;隔离全在后端(owner+code+member 解析)。cancelled=删成功;后端 404
// (不是你约的/已没了)也当作 cancelled —— 卡片落到已取消态,不给越权者任何反馈差异。
// 网络抖动 → error,留在 idle 可重试。

'use client';

import { useCallback, useState } from 'react';

import { postBookingCancellation } from '@/lib/api/booking';
import { loadStoredSession } from '@/lib/gate/use-gate';

export type BookingCancelPhase = 'idle' | 'cancelling' | 'cancelled';

export interface BookingCancelControl {
  phase: BookingCancelPhase;
  error: string | null;
  cancel: () => void;
}

export function useBookingCancel(eventID: string): BookingCancelControl {
  const [phase, setPhase] = useState<BookingCancelPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback((): void => {
    void runCancel(eventID, setPhase, setError);
  }, [eventID]);

  return { phase, error, cancel };
}

const unavailableMsg = 'couldn’t cancel right now — try again later.';

async function runCancel(
  eventID: string,
  setPhase: (p: BookingCancelPhase) => void, setError: (e: string | null) => void,
): Promise<void> {
  const token = loadStoredSession()?.session_token ?? '';
  if (token === '' || eventID === '') { setError(unavailableMsg); return; }
  setError(null);
  setPhase('cancelling');
  const outcome = await postBookingCancellation(eventID, token);
  // cancelled / not_found 都落到已取消(404 = 越权或已没了,UI 一视同仁)。
  if (outcome === 'error') {
    setPhase('idle');
    setError(unavailableMsg);
    return;
  }
  setPhase('cancelled');
}
