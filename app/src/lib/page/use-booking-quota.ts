// use-booking-quota —— 从 capability store 读 calendar.book 剩余 booking
// 配额。code 没设 max_bookings / capability 缺失 / quota_remaining 缺失
// → 返 null (UI 不渲 badge)。

import { useCapabilityStore } from '@/lib/visitor/capability-store';

const CAP_CALENDAR_BOOK = 'calendar.book';

export function useBookingsRemaining(): number | null {
  return useCapabilityStore((s) => pickQuota(s.states));
}

function pickQuota(
  states: readonly { id: string; quota_remaining?: number }[],
): number | null {
  const cap = states.find((c) => c.id === CAP_CALENDAR_BOOK);
  return cap?.quota_remaining ?? null;
}
