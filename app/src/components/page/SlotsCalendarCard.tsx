// SlotsCalendarCard —— #124: calendar_list_slots 的「可用时间」卡片。
// Calendly 式布局:react-day-picker 月历(有空档的日子高亮、无空档禁用),选中
// 某天 → 右侧列该天的时段 chips;点 chip → onAsk 把"约这个时段"作为一条 visitor
// message 喂下一 turn,agent 调 calendar_book。整张卡 collapsible(<details>),
// 默认展开 —— 替换原来 50 行平铺 list。
//
// 纯展示:派生(分组 / 选中天 / 预约文案)全在 use-slot-calendar + slot-calendar。
// onAsk 缺省(无 handler)→ chips 退化成只读文本。

'use client';

import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

import { bookMessage } from '@/lib/page/slot-calendar';
import { formatDayLabel, formatTimeRange } from '@/lib/page/slot-format';
import { useSlotCalendar } from '@/lib/page/use-slot-calendar';
import type { SlotView } from '@/lib/page/tool-call-shape';
import styles from '@/components/page/SlotsCalendarCard.module.css';

interface Props {
  slots: readonly SlotView[];
  remaining: number | null;
  onAsk?: (q: string) => void;
}

export function SlotsCalendarCard({ slots, remaining, onAsk }: Props) {
  const cal = useSlotCalendar(slots);
  return (
    <details className={styles['card']} open data-testid="tool-card-calendar_list_slots">
      <summary className={styles['summary']} data-testid="bookings-kicker">
        available · {slots.length} slots
        {remaining !== null && (
          <span data-testid="bookings-remaining"> · {remaining} bookings left</span>
        )}
      </summary>
      <div className={styles['body']}>
        <DayPicker
          className={styles['picker']}
          mode="single"
          required
          selected={cal.selected}
          onSelect={cal.setSelected}
          startMonth={cal.days[0]}
          disabled={(d) => !cal.isOpen(d)}
          modifiers={{ open: cal.days }}
          modifiersClassNames={{ open: styles['dayOpen'] ?? '' }}
        />
        <DayTimes label={formatDayLabel(cal.selected)} slots={cal.daySlots} onAsk={onAsk} />
      </div>
    </details>
  );
}

function DayTimes({ label, slots, onAsk }: {
  label: string; slots: SlotView[]; onAsk?: (q: string) => void;
}) {
  return (
    <div className={styles['times']}>
      <div className={styles['timesHead']}>{label}</div>
      <ul className={styles['chips']}>
        {slots.map((s) => <TimeChip key={s.start} slot={s} onAsk={onAsk} />)}
      </ul>
    </div>
  );
}

function TimeChip({ slot, onAsk }: { slot: SlotView; onAsk?: (q: string) => void }) {
  const label = formatTimeRange(slot.start, slot.end);
  return onAsk === undefined ? (
    <li className={styles['chip']} data-testid="tool-card-slot" data-start={slot.start}>{label}</li>
  ) : (
    <li>
      <button
        type="button"
        className={styles['chipBtn']}
        data-testid="tool-card-slot"
        data-start={slot.start}
        onClick={() => onAsk(bookMessage(slot))}
      >
        {label}
      </button>
    </li>
  );
}
