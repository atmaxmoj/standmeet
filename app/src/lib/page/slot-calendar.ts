// slot-calendar.ts —— calendar_list_slots 的 SlotView[] → 日历 view-model 的
// **纯**派生逻辑(无 React、无 DOM)。SlotsCalendarCard 的展示只消费这里的结果,
// 派生(按天分组 / 哪些天有空档 / 点击 chip 的预约文案)全在这,好单测、好复用。

import { localDayKey, localMidnight, formatDayLabel, formatTimeRange } from '@/lib/page/slot-format';
import type { SlotView } from '@/lib/page/tool-call-shape';

export interface SlotCalendar {
  // days —— 有空档的不同「访客本地」日期,升序。月历高亮 + 默认选中第一个。
  days: Date[];
  // openKeys —— days 的 localDayKey 集合,DayPicker 判一个格子是否可选。
  openKeys: Set<string>;
  // byDay —— localDayKey → 那天的 slots,选中某天时 O(1) 取它的时段。
  byDay: Map<string, SlotView[]>;
}

// buildSlotCalendar —— 一趟扫完 slots 同时建好 days / openKeys / byDay。
export function buildSlotCalendar(slots: readonly SlotView[]): SlotCalendar {
  const byDay = new Map<string, SlotView[]>();
  const days = new Map<string, Date>();
  for (const s of slots) {
    const day = localMidnight(s.start);
    const key = localDayKey(day);
    days.set(key, day);
    const list = byDay.get(key);
    list ? list.push(s) : byDay.set(key, [s]);
  }
  return {
    days: [...days.values()].sort((a, b) => a.getTime() - b.getTime()),
    openKeys: new Set(days.keys()),
    byDay,
  };
}

// slotsForDay —— 某天(DayPicker 选中的 Date)对应的 slots;无 → 空。
export function slotsForDay(cal: SlotCalendar, day: Date): SlotView[] {
  return cal.byDay.get(localDayKey(day)) ?? [];
}

// bookMessage —— 点 time chip → 喂给 agent 的 visitor message。给人话 + 明确
// 指令,agent 结合上一条 list_slots 的上下文调 calendar_book。
export function bookMessage(slot: SlotView): string {
  const start = new Date(slot.start);
  return `Let's book the ${formatDayLabel(start)} ${formatTimeRange(slot.start, slot.end)} slot, please.`;
}
