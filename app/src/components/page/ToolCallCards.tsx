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

import { useTranslations } from 'next-intl';
import type { PublicSessionToolSpec } from '@standmeet/sdk-core';

import { McpAppCard } from '@/components/page/McpAppCard';
import { useToolSpecsStore, uiHtmlForTool } from '@/lib/visitor/tool-specs-store';
import {
  cardKindFor, jsonPretty, isRetrievalTool, retrievalCounts,
  type RetrievalCounts,
} from '@/lib/page/tool-call-shape';
import type { ToolCallView } from '@/lib/page/use-chat';
import styles from '@/components/page/ToolCallCards.module.css';

interface ToolCallCardsProps {
  calls: readonly ToolCallView[];
  // onAsk —— 交互卡(ask_visitor / slots 沙盒卡)把 visitor 选择 forward 进下一
  // turn(经 McpAppCard 的 mcp-ui:submit)。只读卡不用。
  onAsk?: (q: string) => void;
  // conversationID —— booked 沙盒卡的 mcp-ui:tool 派发(cancel / send_confirmation)
  // 凭它 + 访客 session 调 tool；传给 McpAppCard。
  conversationID?: string;
  // noteEvent —— 见 CardCtx：卡上做的事要让下一轮的 agent 知道（F-B-9）。
  noteEvent?: (text: string) => void;
}

export function ToolCallCards({
  calls, onAsk, conversationID, noteEvent,
}: ToolCallCardsProps) {
  const byName = useToolSpecsStore((s) => s.byName);
  // Retrieval (corpus_*) collapses into ONE summary row instead of one iframe per call
  // (UX-10). Everything else — interactive ui:// cards (ask_visitor / booked), skill/ext
  // dumps — still renders as its own card.
  const retrieval = calls.filter((c) => c.ok && isRetrievalTool(c.name));
  const others = otherCards(calls, byName);
  return retrieval.length + others.length === 0 ? null : (
    <div className={styles['stack']} data-testid="tool-call-cards">
      {retrieval.length > 0 ? <RetrievalSummary counts={retrievalCounts(retrieval)} /> : null}
      {others.map((c, i) => (
        <ToolCallCard
          key={`${c.name}-${i}`} call={c}
          onAsk={onAsk} conversationID={conversationID} noteEvent={noteEvent}
        />
      ))}
    </div>
  );
}

// otherCards —— 非检索、且可渲的 tool call(交互 ui:// 卡 / skill·ext dump)。检索族
// 折叠成 RetrievalSummary,不走这里。
function otherCards(
  calls: readonly ToolCallView[], byName: Record<string, PublicSessionToolSpec>,
): ToolCallView[] {
  return calls.filter((c) => !isRetrievalTool(c.name) && renderableCall(c, byName));
}

// RetrievalSummary —— 折叠后的检索行:一行、原地,不随检索次数堆叠(UX-10)。
// 「读到的具体内容」在 citations footer;这里只报「搜/读了多少次」的透明度。
function RetrievalSummary({ counts }: { counts: RetrievalCounts }) {
  const t = useTranslations('page');
  return (
    <div className={styles['retrievalSummary']} data-testid="retrieval-summary">
      <span className={styles['kicker']}>{t('toolCalls.searched', { count: counts.searches })}</span>
      <span aria-hidden>·</span>
      <span className={styles['kicker']}>{t('toolCalls.read', { count: counts.reads })}</span>
    </div>
  );
}

// renderableCall —— 渲卡判定。tool 自带 ui:// 卡（per-tool ui_html）→ 渲沙盒；
// 否则 skill·ext 通用 debug 兜底（cardKindFor → dump）。皆无 → 不渲。
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
  // noteEvent —— 卡上派出去的工具调用要进这段对话的历史（F-B-9）。
  noteEvent?: (text: string) => void;
}

// NON_SANDBOX_CARDS —— 工具没自带 ui:// 卡时的兜底渲染（按 kind 查表，避开
// presentation 层 if）。dump (skill_*/ext_*) → GenericDumpCard：任意「无卡」工具的
// 通用 debug 兜底（不是按能力写死的卡；自带卡的 externalized 工具走沙盒）。booked 卡
// 已外置成 booker 插件的 ui:// 沙盒卡，不再有写死的 React 卡。
const NON_SANDBOX_CARDS: Record<
  Exclude<ReturnType<typeof cardKindFor>, 'none'>,
  (ctx: CardCtx) => React.ReactElement | null
> = {
  dump: ({ call }) => <GenericDumpCard call={call} />,
};

function ToolCallCard(ctx: CardCtx) {
  // tool 自带 ui:// 卡 → 沙盒渲染（per-tool，能力自包含自己的渲染）；否则走兜底。
  const byName = useToolSpecsStore((s) => s.byName);
  const uiHtml = uiHtmlForTool(byName, ctx.call.name);
  return uiHtml !== ''
    ? (
      <McpAppCard
        call={ctx.call} html={uiHtml} onAsk={ctx.onAsk}
        conversationID={ctx.conversationID} noteEvent={ctx.noteEvent}
      />
    )
    : nonSandboxCard(ctx);
}

function nonSandboxCard(ctx: CardCtx) {
  const kind = cardKindFor(ctx.call.name);
  return kind === 'none' ? null : NON_SANDBOX_CARDS[kind](ctx);
}

// GenericDumpCard —— skill_* / ext_* tool 结果的兜底卡。
//
// **它的受众是 owner，但它渲染在访客的逐字稿里**（F-D-10）。原来的写法把结果直接 `<pre>`
// 摊开：prod 上一个第三方 MCP 工具回了 374 KB，访客看到的就是一大块没解转义的 JSON ——
// 开头那个引号和满屏 `\n` 字面量都在，而他要读的答案在那底下。
//
// 检索族早就折成一行（`RetrievalSummary`），自带卡的能力走沙盒卡，**只有这个兜底还在摊**。
// 所以这里也折起来：默认只留一行「跑了哪个工具」，owner 想看载荷点开就有 —— 兜底不该把
// 「没配卡」变成「把原始载荷糊到用户脸上」（[[display-fallback-reintroduces-the-bug]]）。
function GenericDumpCard({ call }: { call: ToolCallView }) {
  return (
    <details className={styles['genericCard']} data-testid={`tool-card-${call.name}`}>
      <summary className={styles['kicker']}>{call.name}</summary>
      <pre className={styles['dump']}>{jsonPretty(call.result)}</pre>
    </details>
  );
}
