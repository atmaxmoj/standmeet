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

import { useEffect, useRef } from 'react';

import { ChatMarkdown } from '@/components/page/markdown';
import { DeckHeader } from '@/components/page/DeckHeader';
import { ToolCallCards } from '@/components/page/ToolCallCards';
import type { Citation, Dialog, DialogAnswer } from '@/lib/page/use-chat';

type Props = {
  ownerHandle: string;
  dialogs: Dialog[];
  onReset: () => void;
  // onAsk —— I.1: ask_visitor 卡里的 button click 走这条把选中项当作下
  // 一 turn 投出去；不传 → ask_visitor 卡不渲 (功能未启用)。
  onAsk?: (q: string) => void;
};

export function ConversationDeck({ ownerHandle, dialogs, onReset, onAsk }: Props) {
  // The ask input sits up in the hero; the answer streams in down here. Without
  // this, asking leaves the viewport on the empty input and looks like nothing
  // happened. Scroll the newest Q/A to the top of the view the moment it's added
  // (keyed on the last dialog's id so it fires once per question, not per stream
  // tick), so the visitor watches their question + the answer retrieve in place.
  const lastCardRef = useRef<HTMLElement>(null);
  const lastId = dialogs.length > 0 ? dialogs[dialogs.length - 1]!.id : null;
  useEffect(() => {
    lastCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [lastId]);
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
      {dialogs.map((d, i) => (
        <DialogCard
          key={d.id} idx={i} dialog={d}
          ownerHandle={ownerHandle} onAsk={onAsk}
          cardRef={i === dialogs.length - 1 ? lastCardRef : undefined}
        />
      ))}
    </section>
  );
}

function DialogCard({ idx, dialog, ownerHandle, onAsk, cardRef }: {
  idx: number; dialog: Dialog; ownerHandle: string;
  onAsk?: (q: string) => void;
  cardRef?: React.Ref<HTMLElement>;
}) {
  return (
    <article ref={cardRef} id={`qa-${idx}`} className="scroll-mt-6 pt-10 pb-10 border-b border-(--color-rule)">
      <VisitorLabel time={dialog.time} />
      <p className="font-serif italic mb-7 text-[22px] leading-[1.3] font-[380] tracking-[-0.003em] [text-wrap:pretty]">
        {dialog.q}
      </p>
      <AssistantBody dialog={dialog} ownerHandle={ownerHandle} onAsk={onAsk} />
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

function AssistantBody({ dialog, ownerHandle, onAsk }: {
  dialog: Dialog; ownerHandle: string; onAsk?: (q: string) => void;
}) {
  return (
    <>
      <ToolThrobbers labels={dialog.toolStartedLabels} />
      {dialog.pending
        ? <Thinking retrying={dialog.retrying} />
        : <AnswerOrError dialog={dialog} ownerHandle={ownerHandle} onAsk={onAsk} />}
    </>
  );
}

// ToolThrobbers —— per-tool 进度行。label 已在 use-chat 按 name+args 拼好
// (throbber-label.ts:动词轮换 + 在读哪个文档),这里直接渲。
function ToolThrobbers({ labels }: { labels: readonly string[] }) {
  return labels.length === 0 ? null : (
    <ul
      data-testid="tool-throbbers"
      className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mb-3"
    >
      {labels.map((label, i) => <ToolThrobberRow key={i} label={label} />)}
    </ul>
  );
}

function ToolThrobberRow({ label }: { label: string }) {
  return (
    <li data-testid="tool-throbber">
      {label}
      <span className="dot">·</span>
      <span className="dot">·</span>
      <span className="dot">·</span>
    </li>
  );
}

function AnswerOrError({ dialog, ownerHandle, onAsk }: {
  dialog: Dialog; ownerHandle: string; onAsk?: (q: string) => void;
}) {
  return (
    <>
      <AssistantLabel ownerHandle={ownerHandle} />
      <ToolCallCards calls={dialog.toolCalls} dialogID={dialog.id} onAsk={onAsk} />
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

// Thinking —— 等回答的点点。retrying 时(backend 重试 transient LLM 失败)
// 换 "retrying" 文案。
function Thinking({ retrying }: { retrying: boolean }) {
  return (
    <div
      className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mt-3"
      data-retrying={retrying ? 'true' : 'false'}
    >
      {retrying ? 'retrying' : 'retrieving'}{' '}
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

// Citations —— one quiet "references · N" line under the answer, collapsed by
// default (like a normal AI chat's sources). Click to expand the list; each row
// expands again to its source body. Keeps the answer the main thing to read.
function Citations({ citations }: { citations: readonly Citation[] }) {
  return citations.length === 0 ? null : (
    <details className="group mt-6" data-testid="citations">
      <summary className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) cursor-pointer list-none marker:hidden select-none hover:text-(--color-accent) transition-colors inline-flex items-baseline gap-1.5">
        references · {citations.length}
        <span className="text-(--color-faint) group-open:rotate-90 transition-transform">›</span>
      </summary>
      <ul className="space-y-1 mt-2">
        {citations.map((c) => <CitationRow key={c.path} c={c} />)}
      </ul>
    </details>
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
