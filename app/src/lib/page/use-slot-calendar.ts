// use-slot-calendar.ts —— SlotsCalendarCard 的状态 hook:把纯 model
// (slot-calendar.ts) 包成一个干净 view-model,组件只管渲染。
//   - useMemo 缓存按天分组(slots 变才重算)
//   - useState 记住选中的那天(默认第一个有空档的)

import { useMemo, useState } from 'react';

import { buildSlotCalendar, slotsForDay } from '@/lib/page/slot-calendar';
import { localDayKey } from '@/lib/page/slot-format';
import type { SlotView } from '@/lib/page/tool-call-shape';

export interface SlotCalendarView {
  days: Date[];
  selected: Date;
  setSelected: (d: Date) => void;
  daySlots: SlotView[];
  isOpen: (d: Date) => boolean;
}

export function useSlotCalendar(slots: readonly SlotView[]): SlotCalendarView {
  const cal = useMemo(() => buildSlotCalendar(slots), [slots]);
  const [selected, setSelected] = useState<Date>(() => cal.days[0] ?? new Date());
  return {
    days: cal.days,
    selected,
    setSelected,
    daySlots: slotsForDay(cal, selected),
    isOpen: (d) => cal.openKeys.has(localDayKey(d)),
  };
}
