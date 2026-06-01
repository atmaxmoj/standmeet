// ConversationDeck —— inline 累加的 Q/A 流，每个 Dialog 一张卡：
//   you · HH:MM
//   <serif italic question>
//   alice's ai
//   <answer body  OR  retrieving · · ·>
//   <citations 列表>
//
// 这是公开页 chat 的"主表演" —— visitor 问完不滚出去看个 modal，而是在
// 页面 inline 累加，跟 Hero 同一根纵向阅读流上，符合设计稿"transcript
// flow, not alternating bubbles"。
//
// 命名 (G-1.5)：Turn → Dialog；Citation.kind → genre, Citation.id → path。

'use client';

import { ChatMarkdown } from '@/components/page/markdown';
import { DeckHeader } from '@/components/page/DeckHeader';
import { ToolCallCards } from '@/components/page/ToolCallCards';
import type { Citation, Dialog, DialogAnswer } from '@/lib/page/use-chat';

type Props = {
  ownerHandle: string;
  dialogs: Dialog[];
  onReset: () => void;
};

export function ConversationDeck({ ownerHandle, dialogs, onReset }: Props) {
  return (
    <section id="conversation" className="mt-16" data-testid="conversation-deck">
      <DeckHeader
        kicker="conversation"
        count={dialogs.length}
        action={
          <button
            type="button"
            onClick={onReset}
            className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent) transition-colors"
          >
            ↺ reset
          </button>
        }
      />
      {dialogs.map((d, i) => <DialogCard key={d.id} idx={i} dialog={d} ownerHandle={ownerHandle} />)}
    </section>
  );
}

function DialogCard({ idx, dialog, ownerHandle }: { idx: number; dialog: Dialog; ownerHandle: string }) {
  return (
    <article id={`qa-${idx}`} className="pt-10 pb-10 border-b border-(--color-rule)">
      <VisitorLabel time={dialog.time} />
      <p className="font-serif italic mb-7 text-[22px] leading-[1.3] font-[380] tracking-[-0.003em] [text-wrap:pretty]">
        {dialog.q}
      </p>
      <AssistantBody dialog={dialog} ownerHandle={ownerHandle} />
    </article>
  );
}

function VisitorLabel({ time }: { time: string }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.18em] uppercase mb-3 flex items-baseline gap-3">
      <span className="text-(--color-ink)">you</span>
      <span className="text-(--color-faint) normal-case tracking-[0.06em]">· {time}</span>
    </div>
  );
}

function AssistantBody({ dialog, ownerHandle }: { dialog: Dialog; ownerHandle: string }) {
  return (
    <>
      <ToolThrobbers names={dialog.toolStartedNames} />
      {dialog.pending
        ? <Thinking />
        : <AnswerOrError dialog={dialog} ownerHandle={ownerHandle} />}
    </>
  );
}

function ToolThrobbers({ names }: { names: readonly string[] }) {
  return names.length === 0 ? null : (
    <ul
      data-testid="tool-throbbers"
      className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mb-3"
    >
      {names.map((n, i) => (
        <li key={i} data-testid={`tool-throbber-${n}`}>
          {throbberLabel(n)}
          <span className="dot">·</span>
          <span className="dot">·</span>
          <span className="dot">·</span>
        </li>
      ))}
    </ul>
  );
}

function throbberLabel(name: string): string {
  return THROBBER_LABELS[name] ?? `running ${name}`;
}

const THROBBER_LABELS: Record<string, string> = {
  corpus_search: 'searching corpus',
  corpus_read: 'reading entry',
  corpus_list: 'listing entries',
  calendar_book: 'booking meeting',
};

function AnswerOrError({ dialog, ownerHandle }: { dialog: Dialog; ownerHandle: string }) {
  return (
    <>
      <AssistantLabel ownerHandle={ownerHandle} />
      <ToolCallCards calls={dialog.toolCalls} />
      {dialog.answer && <Answer answer={dialog.answer} />}
    </>
  );
}

function AssistantLabel({ ownerHandle }: { ownerHandle: string }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-(--color-accent) mb-3">
      {ownerHandle}&rsquo;s ai
    </div>
  );
}

function Thinking() {
  return (
    <div className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mt-3">
      retrieving{' '}
      <span className="dot">·</span>
      <span className="dot">·</span>
      <span className="dot">·</span>
    </div>
  );
}

function Answer({ answer }: { answer: DialogAnswer }) {
  return (
    <div>
      <AnswerScopeLabel answer={answer} />
      <AnswerParas answer={answer} />
      <Citations citations={answer.citations} />
    </div>
  );
}

function AnswerScopeLabel({ answer }: { answer: DialogAnswer }) {
  const scope = pickScope(answer);
  return scope === '' ? null : <ScopeBadge text={scope} />;
}

function pickScope(answer: DialogAnswer): string {
  return answer.byoaiBlocked
    ? 'public scope only · need a code'
    : answer.private ? 'private · layered access' : '';
}

function ScopeBadge({ text }: { text: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-accent) mb-3">
      {text}
    </div>
  );
}

function AnswerParas({ answer }: { answer: DialogAnswer }) {
  const gated = answer.private || answer.byoaiBlocked;
  const cls = gated ? 'pl-5 border-l-2 border-(--color-accent)/40' : '';
  return (
    <div className={cls} data-testid="answer-body">
      {answer.paras.map((p, i) => (
        <div key={i} className="reading mb-4 last:mb-0 text-[18px]">
          <ChatMarkdown source={p} />
        </div>
      ))}
    </div>
  );
}

function Citations({ citations }: { citations: readonly Citation[] }) {
  return citations.length === 0 ? null : (
    <div className="mt-6" data-testid="citations">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">drawn from</div>
      <ul className="space-y-1">
        {citations.map((c) => <CitationRow key={c.path} c={c} />)}
      </ul>
    </div>
  );
}

// CitationRow —— G-3: <details>/<summary> 让 citation 可点；展开后 inline
// 渲 body 原文 (corpus_read 已经把 body 拿到手，不走二次 fetch)。
// `data-testid="citation-row"` 让 spec 锁定一行 expand 测断言。
function CitationRow({ c }: { c: Citation }) {
  return (
    <li>
      <details className="group" data-testid="citation-row" data-citation-path={c.path}>
        <summary className="flex items-baseline gap-3 cursor-pointer list-none marker:hidden hover:text-(--color-accent) transition-colors">
          <span
            className={`mono text-[10px] tracking-[0.14em] uppercase tabular-nums shrink-0 ${
              c.genre === 'output' ? 'text-(--color-accent)' : 'text-(--color-muted)'
            }`}
            data-testid={`citation-genre-${c.genre}`}
          >
            {c.genre}
          </span>
          <span className="font-serif italic text-(--color-muted) text-[14.5px] group-open:text-(--color-ink) transition-colors">{c.title}</span>
          <span className="mono text-[10px] text-(--color-faint) ml-auto shrink-0 group-open:rotate-90 transition-transform">›</span>
        </summary>
        <div
          className="mt-3 mb-2 pl-5 border-l border-(--color-rule) reading text-[15px]"
          data-testid="citation-body"
        >
          <ChatMarkdown source={c.body} />
        </div>
      </details>
    </li>
  );
}
