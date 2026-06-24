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

import type { PublicSessionToolSpec } from '@standmeet/sdk-core';

import { McpAppCard } from '@/components/page/McpAppCard';
import { BookingEmailPrompt } from '@/components/page/BookingEmailPrompt';
import { useToolSpecsStore, uiHtmlForTool } from '@/lib/visitor/tool-specs-store';
import {
  pickBookConfirmation,
  cardKindFor, jsonPretty,
  type BookConfirmation,
} from '@/lib/page/tool-call-shape';
import { formatSlotLocal } from '@/lib/page/slot-format';
import { useBookingCancel, type BookingCancelControl } from '@/lib/page/use-booking-cancel';
import type { ToolCallView } from '@/lib/page/use-chat';
import styles from '@/components/page/ToolCallCards.module.css';

interface ToolCallCardsProps {
  calls: readonly ToolCallView[];
  // onAsk —— 交互卡(ask_visitor / slots 沙盒卡)把 visitor 选择 forward 进下一
  // turn(经 McpAppCard 的 mcp-ui:submit)。只读卡不用。
  onAsk?: (q: string) => void;
  // conversationID —— #122: BookCard 发约成确认信要带这段对话 id。
  conversationID?: string;
}

export function ToolCallCards({ calls, onAsk, conversationID }: ToolCallCardsProps) {
  const byName = useToolSpecsStore((s) => s.byName);
  const visible = calls.filter((c) => renderableCall(c, byName));
  return visible.length === 0 ? null : (
    <div className={styles['stack']} data-testid="tool-call-cards">
      {visible.map((c, i) => (
        <ToolCallCard
          key={`${c.name}-${i}`} call={c}
          onAsk={onAsk} conversationID={conversationID}
        />
      ))}
    </div>
  );
}

// renderableCall —— 渲卡判定。tool 自带 ui:// 卡（per-tool ui_html）→ 渲沙盒；
// 否则 booked 遗留卡 / skill·ext 通用兜底（cardKindFor）。皆无 → 不渲。
function renderableCall(
  c: ToolCallView, byName: Record<string, PublicSessionToolSpec>,
): boolean {
  const uiHtml = uiHtmlForTool(byName, c.name);
  return c.ok && (uiHtml !== '' || cardKindFor(c.name) !== 'none');
}

// CardCtx —— dispatch 每张卡拿到的上下文(call + onAsk + conversationID)。
interface CardCtx {
  call: ToolCallView;
  onAsk?: (q: string) => void;
  conversationID?: string;
}

// NON_SANDBOX_CARDS —— 工具没自带 ui:// 卡时的兜底渲染（按 kind 查表，避开
// presentation 层 if）：
//   - dump (skill_*/ext_*) → GenericDumpCard：任意「无卡」工具的通用 debug 兜底
//     （不是按能力写死的卡，是 fallback；自带卡的 externalized 工具走沙盒）。
//   - booked (calendar_book) → BookCard：**唯一遗留写死卡**。cancel / 发确认信是
//     connector-backed mutation，从卡触发，归 connector 重构（booked 卡随之外置）。
const NON_SANDBOX_CARDS: Record<
  Exclude<ReturnType<typeof cardKindFor>, 'none'>,
  (ctx: CardCtx) => React.ReactElement | null
> = {
  dump:   ({ call }) => <GenericDumpCard call={call} />,
  booked: ({ call, conversationID }) => <BookCard call={call} conversationID={conversationID} />,
};

function ToolCallCard(ctx: CardCtx) {
  // tool 自带 ui:// 卡 → 沙盒渲染（per-tool，能力自包含自己的渲染）；否则走兜底。
  const byName = useToolSpecsStore((s) => s.byName);
  const uiHtml = uiHtmlForTool(byName, ctx.call.name);
  return uiHtml !== ''
    ? <McpAppCard call={ctx.call} html={uiHtml} onAsk={ctx.onAsk} />
    : nonSandboxCard(ctx);
}

function nonSandboxCard(ctx: CardCtx) {
  const kind = cardKindFor(ctx.call.name);
  return kind === 'none' ? null : NON_SANDBOX_CARDS[kind](ctx);
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
