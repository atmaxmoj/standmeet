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
import { useToolSpecsStore, uiHtmlForTool } from '@/lib/visitor/tool-specs-store';
import { cardKindFor, jsonPretty } from '@/lib/page/tool-call-shape';
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
    ? <McpAppCard call={ctx.call} html={uiHtml} onAsk={ctx.onAsk} conversationID={ctx.conversationID} />
    : nonSandboxCard(ctx);
}

function nonSandboxCard(ctx: CardCtx) {
  const kind = cardKindFor(ctx.call.name);
  return kind === 'none' ? null : NON_SANDBOX_CARDS[kind](ctx);
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
