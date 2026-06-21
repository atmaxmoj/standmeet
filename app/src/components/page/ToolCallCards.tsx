// ToolCallCards —— G-4: 渲 answer.toolCalls per tool name(assistant 这一轮调的工具)。
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

import type { CapabilityState } from '@standmeet/agent-core';

import { McpAppCard } from '@/components/page/McpAppCard';
import { BookingEmailPrompt } from '@/components/page/BookingEmailPrompt';
import { useCapabilityStore, uiHtmlForTool } from '@/lib/visitor/capability-store';
import { logger } from '@/lib/logger';
import { ReportArtifactCard } from '@/components/page/ReportArtifactCard';
import { SlotsCalendarCard } from '@/components/page/SlotsCalendarCard';
import {
  pickSearchHits, pickSlots, pickBookConfirmation,
  cardKindFor, jsonPretty,
  type SearchHit, type BookConfirmation,
} from '@/lib/page/tool-call-shape';
import { formatSlotLocal } from '@/lib/page/slot-format';
import { useBookingsRemaining } from '@/lib/page/use-booking-quota';
import { useBookingCancel, type BookingCancelControl } from '@/lib/page/use-booking-cancel';
import type { ToolCallView } from '@/lib/page/use-chat';
import styles from '@/components/page/ToolCallCards.module.css';

interface ToolCallCardsProps {
  calls: readonly ToolCallView[];
  // dialogID + onAsk —— I.1: ask_visitor 卡需要知道 dialog id (用来跟
  // store 去重) 以及把 visitor 选项 forward 进下一 turn。其他 card 不用。
  // 旧 caller 没传 onAsk → ask_visitor card 不渲 (跟"功能未启用"等价)。
  dialogID?: string;
  onAsk?: (q: string) => void;
  // conversationID —— #122: BookCard 发约成确认信要带这段对话 id。
  conversationID?: string;
}

export function ToolCallCards({ calls, dialogID, onAsk, conversationID }: ToolCallCardsProps) {
  const states = useCapabilityStore((s) => s.states);
  const visible = calls.filter((c) => renderableCall(c, states));
  return visible.length === 0 ? null : (
    <div className={styles['stack']} data-testid="tool-call-cards">
      {visible.map((c, i) => (
        <ToolCallCard
          key={`${c.name}-${i}`} call={c}
          dialogID={dialogID} onAsk={onAsk} conversationID={conversationID}
        />
      ))}
    </div>
  );
}

// renderableCall —— 渲卡判定。外置能力自带 ui:// 卡（extra.ui.html）→ 渲沙盒；
// 否则尚未外置的 legacy 卡（cardKindFor）。两者皆无 → 不渲。
function renderableCall(c: ToolCallView, states: readonly CapabilityState[]): boolean {
  const uiHtml = uiHtmlForTool(states, c.name);
  const renderable = c.ok && (uiHtml !== '' || cardKindFor(c.name) !== 'none');
  logger.info('tool card render decision', {
    name: c.name, ok: c.ok, uiHtmlLen: uiHtml.length,
    kind: cardKindFor(c.name), renderable,
  });
  return renderable;
}

// CardCtx —— dispatch 每个 renderer 拿到的全套上下文(call + 几张卡各自需要的
// dialogID / onAsk / conversationID),按 kind 查表渲,避开 presentation 层 if。
interface CardCtx {
  call: ToolCallView;
  dialogID?: string;
  onAsk?: (q: string) => void;
  conversationID?: string;
}

// LEGACY_CARD_RENDERERS —— 尚未外置能力的写死卡，随各能力外置逐个删除（目标态为
// 空）。外置能力走沙盒 McpAppCard，不在这。ask_visitor 已外置 → 不在这。
const LEGACY_CARD_RENDERERS: Record<
  Exclude<ReturnType<typeof cardKindFor>, 'none'>,
  (ctx: CardCtx) => React.ReactElement | null
> = {
  search: ({ call }) => <SearchHitsCard call={call} />,
  report: ({ call }) => <ReportArtifactCard call={call} />,
  dump:   ({ call }) => <GenericDumpCard call={call} />,
  slots:  (ctx) => <SlotsCard call={ctx.call} onAsk={ctx.onAsk} />,
  booked: (ctx) => <BookCard call={ctx.call} conversationID={ctx.conversationID} />,
};

function ToolCallCard(ctx: CardCtx) {
  // 外置 MCP app 自带 ui:// 卡 → 沙盒渲染。能力自包含自己的渲染。
  const states = useCapabilityStore((s) => s.states);
  const uiHtml = uiHtmlForTool(states, ctx.call.name);
  return sandboxCard(ctx, uiHtml) ?? legacyCard(ctx);
}

function sandboxCard({ call, onAsk }: CardCtx, uiHtml: string) {
  return uiHtml !== '' && onAsk !== undefined
    ? <McpAppCard call={call} html={uiHtml} onAsk={onAsk} />
    : null;
}

// legacyCard —— 尚未外置能力的写死卡（随外置进度删空）。
function legacyCard({ call, dialogID, onAsk, conversationID }: CardCtx) {
  const kind = cardKindFor(call.name);
  return kind === 'none'
    ? null
    : LEGACY_CARD_RENDERERS[kind]({ call, dialogID, onAsk, conversationID });
}

// SearchHitsCard —— collapsed by default. Dumping every search hit + summary
// inline before the answer buries the reading like raw tool output; a normal AI
// chat keeps it tucked away. We show a quiet "searched · N entries" line the
// reader can expand for transparency, so the answer stays the main thing.
function SearchHitsCard({ call }: { call: ToolCallView }) {
  const hits = pickSearchHits(call.result);
  return hits.length === 0 ? null : (
    <details
      className={styles['searchCard']}
      data-testid={`tool-card-${call.name}`}
    >
      <summary className={`${styles['kicker']} cursor-pointer list-none marker:hidden select-none hover:text-(--color-accent) transition-colors`}>
        {call.name === 'corpus_list' ? 'browsed' : 'searched'} · {hits.length} entries
      </summary>
      <ul className={styles['hits']}>
        {hits.map((h) => <SearchHitRow key={h.path} h={h} />)}
      </ul>
    </details>
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
function SlotsCard({ call, onAsk }: { call: ToolCallView; onAsk?: (q: string) => void }) {
  const slots = pickSlots(call.result);
  const remaining = useBookingsRemaining();
  return slots.length === 0
    ? <SlotsEmpty remaining={remaining} />
    : <SlotsCalendarCard slots={slots} remaining={remaining} onAsk={onAsk} />;
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

// BookCard —— calendar_book 成功 confirmation。约成后给一截"发确认邮件吗"
// (#122),收件人引用 session email / 透传现填地址 / 不发;owner 没配 mail
// connector 时那截不渲染。
function BookCard({ call, conversationID }: {
  call: ToolCallView; conversationID?: string;
}) {
  const conf = pickBookConfirmation(call.result);
  return conf === null ? null : (
    <BookCardBody conf={conf} conversationID={conversationID} />
  );
}

function BookCardBody({ conf, conversationID }: {
  conf: BookConfirmation; conversationID?: string;
}) {
  const cancel = useBookingCancel(conf.eventID);
  const cancelled = cancel.phase === 'cancelled';
  return (
    <div
      className={styles['bookCard']} data-testid="tool-card-calendar_book"
      data-cancelled={cancelled}
    >
      <div className={styles['kicker']}>{cancelled ? 'cancelled' : 'booked'}</div>
      <div className={styles['bookTime']} data-testid="book-card-time">
        {formatSlotLocal(conf.start, conf.end)}
      </div>
      {cancelled
        ? <div className={styles['kicker']} data-testid="book-card-cancelled">this meeting was cancelled</div>
        : <BookCardLive conf={conf} conversationID={conversationID} cancel={cancel} />}
    </div>
  );
}

// BookCardLive —— 未取消时的 card 下半:GCal 链接 + 确认邮件 widget + 取消按钮。
function BookCardLive({ conf, conversationID, cancel }: {
  conf: BookConfirmation; conversationID?: string; cancel: BookingCancelControl;
}) {
  return (
    <>
      {conf.htmlLink !== '' && (
        <a
          href={conf.htmlLink} target="_blank" rel="noopener noreferrer"
          className={styles['bookLink']} data-testid="book-card-link"
        >
          open in google calendar →
        </a>
      )}
      <BookingEmailPrompt conversationID={conversationID} />
      <BookCardCancel cancel={cancel} />
    </>
  );
}

function BookCardCancel({ cancel }: { cancel: BookingCancelControl }) {
  return (
    <div className={styles['cancelRow']}>
      <button
        type="button" className={styles['cancelBtn']}
        disabled={cancel.phase === 'cancelling'}
        data-testid="book-card-cancel" onClick={cancel.cancel}
      >
        cancel meeting
      </button>
      {cancel.error !== null && (
        <span className={styles['cancelErr']} data-testid="book-card-cancel-error">
          {cancel.error}
        </span>
      )}
    </div>
  );
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
