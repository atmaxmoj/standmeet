// ToolCallCards —— G-4: 渲 Dialog.toolCalls per tool name。
//
// dispatch 表：
//   - corpus_search / corpus_list  → SearchHitsCard (path+title+summary 列表)
//   - corpus_read                  → skip (Citation 已渲，重复)
//   - calendar_book                → skip (G-7 单独 confirmation card)
//   - skill_* / ext_*              → GenericDumpCard (debug-grade JSON 框)
//   - 其他                          → null (不渲，避免 chat 噪声)
//
// 位置：ConversationDeck / ChatRoom 渲 answer paras 之前 (transcript flow
// 上："tool 卡 → answer 文本 → citations" 的纵向顺序)。
//
// 数据 narrow 在 lib/page/tool-call-shape.ts；presentation 层只做渲染。

'use client';

import { AskVisitorCard } from '@/components/page/AskVisitorCard';
import { ReportArtifactCard } from '@/components/page/ReportArtifactCard';
import {
  pickSearchHits, pickSlots, pickBookConfirmation,
  shouldRenderCall, cardKindFor, jsonPretty,
  type SearchHit, type SlotView, type BookConfirmation,
} from '@/lib/page/tool-call-shape';
import { useBookingsRemaining } from '@/lib/page/use-booking-quota';
import type { ToolCallView } from '@/lib/page/use-chat';
import styles from '@/components/page/ToolCallCards.module.css';

interface ToolCallCardsProps {
  calls: readonly ToolCallView[];
  // dialogID + onAsk —— I.1: ask_visitor 卡需要知道 dialog id (用来跟
  // store 去重) 以及把 visitor 选项 forward 进下一 turn。其他 card 不用。
  // 旧 caller 没传 onAsk → ask_visitor card 不渲 (跟"功能未启用"等价)。
  dialogID?: string;
  onAsk?: (q: string) => void;
}

export function ToolCallCards({ calls, dialogID, onAsk }: ToolCallCardsProps) {
  const visible = calls.filter(shouldRenderCall);
  return visible.length === 0 ? null : (
    <div className={styles['stack']} data-testid="tool-call-cards">
      {visible.map((c, i) => (
        <ToolCallCard
          key={`${c.name}-${i}`} call={c}
          dialogID={dialogID} onAsk={onAsk}
        />
      ))}
    </div>
  );
}

const CARD_RENDERERS: Record<
  Exclude<ReturnType<typeof cardKindFor>, 'none' | 'ask'>,
  (c: ToolCallView) => React.ReactElement | null
> = {
  search: (call) => <SearchHitsCard call={call} />,
  slots:  (call) => <SlotsCard call={call} />,
  booked: (call) => <BookCard call={call} />,
  report: (call) => <ReportArtifactCard call={call} />,
  dump:   (call) => <GenericDumpCard call={call} />,
};

function ToolCallCard({ call, dialogID, onAsk }: {
  call: ToolCallView; dialogID?: string; onAsk?: (q: string) => void;
}) {
  const kind = cardKindFor(call.name);
  return kind === 'none' ? null : <ToolCallDispatch
    kind={kind} call={call} dialogID={dialogID} onAsk={onAsk}
  />;
}

function ToolCallDispatch({ kind, call, dialogID, onAsk }: {
  kind: Exclude<ReturnType<typeof cardKindFor>, 'none'>;
  call: ToolCallView; dialogID?: string; onAsk?: (q: string) => void;
}) {
  return kind === 'ask' ? <AskVisitorOrNothing
    call={call} dialogID={dialogID} onAsk={onAsk}
  /> : CARD_RENDERERS[kind](call);
}

function AskVisitorOrNothing({ call, dialogID, onAsk }: {
  call: ToolCallView; dialogID?: string; onAsk?: (q: string) => void;
}) {
  return dialogID === undefined || onAsk === undefined ? null
    : <AskVisitorCard call={call} dialogID={dialogID} onAsk={onAsk} />;
}

function SearchHitsCard({ call }: { call: ToolCallView }) {
  const hits = pickSearchHits(call.result);
  return hits.length === 0 ? null : (
    <div
      className={styles['searchCard']}
      data-testid={`tool-card-${call.name}`}
    >
      <div className={styles['kicker']}>
        {call.name === 'corpus_list' ? 'browsed' : 'searched'} · {hits.length} entries
      </div>
      <ul className={styles['hits']}>
        {hits.map((h) => <SearchHitRow key={h.path} h={h} />)}
      </ul>
    </div>
  );
}

function SearchHitRow({ h }: { h: SearchHit }) {
  return (
    <li className={styles['hit']} data-testid="tool-card-hit" data-path={h.path}>
      <span
        className={`${styles['genre']} ${h.genre === 'output' ? styles['genreOutput'] : ''}`}
      >
        {h.genre}
      </span>
      <span className={styles['title']}>{h.title}</span>
      {h.summary && <span className={styles['summary']}>{h.summary}</span>}
    </li>
  );
}

// SlotsCard —— calendar_list_slots 结果。展示可订时间 + 当前剩余 booking
// 配额 (visitor 知道还能约几次)。G-7 minimum：静态显示 owner-local 字符串；
// clickable 设计放 G-7 follow-up。
function SlotsCard({ call }: { call: ToolCallView }) {
  const slots = pickSlots(call.result);
  const remaining = useBookingsRemaining();
  return slots.length === 0 ? <SlotsEmpty remaining={remaining} /> : (
    <div className={styles['slotsCard']} data-testid="tool-card-calendar_list_slots">
      <BookingsKicker prefix={`available · ${slots.length} slots`} remaining={remaining} />
      <ul className={styles['slots']}>
        {slots.map((s) => <SlotRow key={s.start} s={s} />)}
      </ul>
    </div>
  );
}

function SlotsEmpty({ remaining }: { remaining: number | null }) {
  return (
    <div className={styles['slotsCard']} data-testid="tool-card-calendar_list_slots">
      <BookingsKicker prefix="available · 0 slots" remaining={remaining} />
      <div className={styles['slotsEmpty']}>
        no free slots in that window — try a different range.
      </div>
    </div>
  );
}

// BookingsKicker —— 卡 header 拼上"X bookings left"（remaining 非 null 时）。
function BookingsKicker({ prefix, remaining }: { prefix: string; remaining: number | null }) {
  return (
    <div className={styles['kicker']} data-testid="bookings-kicker">
      {prefix}
      {remaining !== null && (
        <span data-testid="bookings-remaining"> · {remaining} bookings left</span>
      )}
    </div>
  );
}

// BookCard —— calendar_book 成功 confirmation。
function BookCard({ call }: { call: ToolCallView }) {
  const conf = pickBookConfirmation(call.result);
  return conf === null ? null : <BookCardBody conf={conf} />;
}

function BookCardBody({ conf }: { conf: BookConfirmation }) {
  return (
    <div className={styles['bookCard']} data-testid="tool-card-calendar_book">
      <div className={styles['kicker']}>booked</div>
      <div className={styles['bookTime']} data-testid="book-card-time">
        {formatSlotLocal(conf.start, conf.end)}
      </div>
      {conf.htmlLink !== '' && (
        <a
          href={conf.htmlLink} target="_blank" rel="noopener noreferrer"
          className={styles['bookLink']} data-testid="book-card-link"
        >
          open in google calendar →
        </a>
      )}
    </div>
  );
}

function SlotRow({ s }: { s: SlotView }) {
  return (
    <li className={styles['slot']} data-testid="tool-card-slot" data-start={s.start}>
      <span className={styles['slotTime']}>{formatSlotLocal(s.start, s.end)}</span>
    </li>
  );
}

// formatSlotLocal —— RFC3339 → 'Wed Jun 4 · 2:00pm-3:00pm' (visitor local
// tz)。简单 Intl.DateTimeFormat，不引重型 lib (luxon / date-fns)。
function formatSlotLocal(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const dayFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit',
  });
  return `${dayFmt.format(start)} · ${timeFmt.format(start)}–${timeFmt.format(end)}`;
}

// GenericDumpCard —— skill_* / ext_* tool 结果。debug-grade JSON pretty
// dump；让 owner 观察 visitor 这边到底跑了啥；不强调视觉。
function GenericDumpCard({ call }: { call: ToolCallView }) {
  return (
    <div className={styles['genericCard']} data-testid={`tool-card-${call.name}`}>
      <div className={styles['kicker']}>{call.name}</div>
      <pre className={styles['dump']}>{jsonPretty(call.result)}</pre>
    </div>
  );
}
