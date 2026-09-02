// ToolCallCards —— G-4: renders answer.toolCalls per tool name (the tools the
// assistant called this turn).
//
// Dispatch table:
//   - corpus_search / corpus_list  → SearchHitsCard (path+title+summary list)
//   - corpus_read                  → skip (already rendered as a Citation, would duplicate)
//   - calendar_book                → skip (G-7 has its own confirmation card)
//   - skill_* / ext_*              → GenericDumpCard (debug-grade JSON box)
//   - anything else                → null (renders nothing, avoids chat noise)
//
// Position: ConversationDeck / ChatRoom render this before the answer paras
// (on the transcript flow, the vertical order is "tool card → answer text →
// citations").
//
// Data narrowing lives in lib/page/tool-call-shape.ts; this presentation
// layer only renders.

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
  // onAsk —— interactive cards (ask_visitor / slots sandboxed cards) forward
  // the visitor's choice into the next turn (via McpAppCard's
  // mcp-ui:submit). Unused by read-only cards.
  onAsk?: (q: string) => void;
  // conversationID —— a booked sandboxed card's mcp-ui:tool dispatch
  // (cancel / send_confirmation) uses this plus the visitor session to call
  // the tool; passed through to McpAppCard.
  conversationID?: string;
  // noteEvent —— see CardCtx: what happens on a card must reach the agent on
  // the next turn (F-B-9).
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

// otherCards —— non-retrieval, renderable tool calls (interactive ui://
// cards / skill·ext dumps). The retrieval family collapses into
// RetrievalSummary and doesn't go through here.
function otherCards(
  calls: readonly ToolCallView[], byName: Record<string, PublicSessionToolSpec>,
): ToolCallView[] {
  return calls.filter((c) => !isRetrievalTool(c.name) && renderableCall(c, byName));
}

// RetrievalSummary —— the collapsed retrieval row: one line, in place, and
// doesn't stack with the number of retrievals (UX-10). The actual content
// that was read lives in the citations footer; this line only reports the
// transparency figure of "how many searches/reads."
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

// renderableCall —— decides whether to render a card. Tool ships its own
// ui:// card (per-tool ui_html) → render sandboxed; otherwise falls back to
// the generic skill·ext debug card (cardKindFor → dump). Neither → renders
// nothing.
function renderableCall(
  c: ToolCallView, byName: Record<string, PublicSessionToolSpec>,
): boolean {
  const uiHtml = uiHtmlForTool(byName, c.name);
  return c.ok && (uiHtml !== '' || cardKindFor(c.name) !== 'none');
}

// CardCtx —— the context each card gets when dispatched (call + onAsk + conversationID).
interface CardCtx {
  call: ToolCallView;
  onAsk?: (q: string) => void;
  conversationID?: string;
  // noteEvent —— a tool call dispatched from a card must go into this
  // conversation's history (F-B-9).
  noteEvent?: (text: string) => void;
}

// NON_SANDBOX_CARDS —— fallback rendering for when a tool doesn't ship its
// own ui:// card (looked up by kind, avoiding an if-chain in the
// presentation layer). dump (skill_*/ext_*) → GenericDumpCard: the generic
// debug fallback for any "no card" tool (not a hardcoded per-capability
// card; externalized tools that ship their own card go sandboxed instead).
// The booked card has already been externalized into the booker plugin's
// ui:// sandboxed card, so there's no hardcoded React card for it anymore.
const NON_SANDBOX_CARDS: Record<
  Exclude<ReturnType<typeof cardKindFor>, 'none'>,
  (ctx: CardCtx) => React.ReactElement | null
> = {
  dump: ({ call }) => <GenericDumpCard call={call} />,
};

function ToolCallCard(ctx: CardCtx) {
  // Tool ships its own ui:// card → render sandboxed (per-tool, the
  // capability contains its own rendering); otherwise fall back.
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

// GenericDumpCard —— the fallback card for skill_* / ext_* tool results.
//
// **Its audience is the owner, but it renders in the visitor's transcript**
// (F-D-10). The original version dumped the result straight into a `<pre>`:
// in prod, a third-party MCP tool returned 374 KB, and the visitor saw one
// giant block of un-escaped JSON — the leading quote and screenfuls of
// literal `\n` all still there, with the answer they actually wanted to
// read buried underneath.
//
// The retrieval family already collapses to one line (`RetrievalSummary`),
// and capabilities that ship their own card go sandboxed — **this fallback
// was the only thing still dumping the raw payload.** So it collapses too:
// by default it leaves just one line saying which tool ran, and the owner
// can expand it to see the payload if they want — a fallback shouldn't turn
// "no card configured" into "smear the raw payload across the user's face"
// ([[display-fallback-reintroduces-the-bug]]).
function GenericDumpCard({ call }: { call: ToolCallView }) {
  return (
    <details className={styles['genericCard']} data-testid={`tool-card-${call.name}`}>
      <summary className={styles['kicker']}>{call.name}</summary>
      <pre className={styles['dump']}>{jsonPretty(call.result)}</pre>
    </details>
  );
}
