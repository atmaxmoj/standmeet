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
import { useTranslations } from 'next-intl';

import { citationHref } from '@/lib/corpus/href';
import { ChatMarkdown } from '@/components/page/markdown';
import { DeckHeader } from '@/components/page/DeckHeader';
import { ToolCallCards } from '@/components/page/ToolCallCards';
import { PartialNotice } from '@/components/visitor/PartialNotice';
import { useThinkingWord } from '@/lib/page/thinking-words';
import type { Answer, Citation, Dialog, ToolThrobberView } from '@/lib/page/use-chat';

type Props = {
  ownerHandle: string;
  dialogs: Dialog[];
  // onAsk —— I.1: ask_visitor 卡里的 button click 走这条把选中项当作下
  // 一 turn 投出去；不传 → ask_visitor 卡不渲 (功能未启用)。
  onAsk?: (q: string) => void;
  // conversationID —— #122: 这段对话 id,BookCard 发约成确认信时带上。
  conversationID?: string;
};

export function ConversationDeck({ ownerHandle, dialogs, onAsk, conversationID }: Props) {
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
      />
      {dialogs.map((d, i) => (
        <DialogCard
          key={d.id} idx={i} dialog={d}
          ownerHandle={ownerHandle} onAsk={onAsk} conversationID={conversationID}
          cardRef={i === dialogs.length - 1 ? lastCardRef : undefined}
        />
      ))}
    </section>
  );
}

function DialogCard({ idx, dialog, ownerHandle, onAsk, conversationID, cardRef }: {
  idx: number; dialog: Dialog; ownerHandle: string;
  onAsk?: (q: string) => void;
  conversationID?: string;
  cardRef?: React.Ref<HTMLElement>;
}) {
  return (
    <article ref={cardRef} id={`qa-${idx}`} className="scroll-mt-6 pt-10 pb-10 border-b border-(--color-rule)">
      <VisitorLabel time={dialog.time} />
      <p className="font-serif italic mb-7 text-[22px] leading-[1.3] font-[380] tracking-[-0.003em] [text-wrap:pretty]">
        {dialog.q}
      </p>
      <AssistantBody
        dialog={dialog} ownerHandle={ownerHandle}
        onAsk={onAsk} conversationID={conversationID}
      />
    </article>
  );
}

function VisitorLabel({ time }: { time: string }) {
  const t = useTranslations('page');
  return (
    <div className="mono text-[10.5px] tracking-[0.18em] uppercase mb-3 flex items-baseline gap-3">
      <span className="text-(--color-ink)">{t('conversation.you')}</span>
      <span className="text-(--color-faint) normal-case tracking-[0.06em]">· {time}</span>
    </div>
  );
}

function AssistantBody({ dialog, ownerHandle, onAsk, conversationID }: {
  dialog: Dialog; ownerHandle: string; onAsk?: (q: string) => void;
  conversationID?: string;
}) {
  // throbber 是 observer 对 agent 的实时观察:只显 agent 此刻在跑的那个 tool,
  // turn 落地即被 use-chat 清成 null 而消失,由 AnswerOrError 里折叠的 searched
  // 卡当持久回执。绝不堆一串、也绝不冻在 transcript 里跟答案并排。
  return (
    <>
      <ToolThrobber tool={dialog.currentTool} />
      {dialog.pending
        ? <Thinking retrying={dialog.retrying} tool={dialog.currentTool} />
        : <AnswerOrError
            dialog={dialog} ownerHandle={ownerHandle}
            onAsk={onAsk} conversationID={conversationID}
          />}
    </>
  );
}

// ToolThrobber —— agent 当前在跑的那一个 tool 的进度行。label 已在 use-chat 按
// name+args+backend progress_label 拼好;name 给 `tool-throbber-<name>` testid。
// tool 为 null(没在跑 / turn 落地)→ 不渲。
function ToolThrobber({ tool }: { tool: ToolThrobberView | null }) {
  return tool === null ? null : (
    <div
      data-testid="tool-throbbers"
      className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mb-3"
    >
      <span data-testid={`tool-throbber-${tool.name}`}>
        {tool.label}
        <span className="dot">·</span>
        <span className="dot">·</span>
        <span className="dot">·</span>
      </span>
    </div>
  );
}

function AnswerOrError({ dialog, ownerHandle, onAsk, conversationID }: {
  dialog: Dialog; ownerHandle: string; onAsk?: (q: string) => void;
  conversationID?: string;
}) {
  return (
    <>
      <AssistantLabel ownerHandle={ownerHandle} />
      <ToolCallCards
        calls={dialog.answer.toolCalls}
        onAsk={onAsk} conversationID={conversationID}
      />
      <AnswerView answer={dialog.answer} />
    </>
  );
}

function AssistantLabel({ ownerHandle }: { ownerHandle: string }) {
  const t = useTranslations('page');
  return (
    <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-(--color-accent) mb-3">
      {t('conversation.assistantLabel', { handle: ownerHandle })}
    </div>
  );
}

// Thinking —— LLM 在想(没具体 tool 在跑)时的进度行。词从 thinking-words 词库
// 每 3 秒轮换;retrying 时(backend 重试 transient LLM 失败)固定显 "retrying"。
// 有 tool 在跑(currentTool≠null)→ 不渲:ToolThrobber 已显 reading/searching,
// 同一时刻只一个进度指示,免得读文档时还并排显 thinking。
function Thinking({ retrying, tool }: { retrying: boolean; tool: ToolThrobberView | null }) {
  const word = useThinkingWord();
  return tool !== null ? null : (
    <div
      className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mt-3"
      data-testid="answer-pending"
      data-retrying={String(retrying)}
    >
      {retrying ? 'retrying' : word}{' '}
      <span className="dot">·</span>
      <span className="dot">·</span>
      <span className="dot">·</span>
    </div>
  );
}

function AnswerView({ answer }: { answer: Answer }) {
  return (
    <div>
      <AnswerParas answer={answer} />
      <Citations citations={answer.citations} />
    </div>
  );
}

function AnswerParas({ answer }: { answer: Answer }) {
  return (
    <div data-testid="answer-body">
      {answer.paras.map((p, i) => (
        <div key={i} className="reading mb-4 last:mb-0 text-[18px]">
          <ChatMarkdown source={p} />
        </div>
      ))}
      <PartialNotice notice={answer.notice} />
    </div>
  );
}

// Citations —— one quiet "references · N" line under the answer, collapsed by
// default (like a normal AI chat's sources). Click to expand the list; each row
// expands again to its source body. Keeps the answer the main thing to read.
function Citations({ citations }: { citations: readonly Citation[] }) {
  const t = useTranslations('page');
  return citations.length === 0 ? null : (
    <details className="group mt-6" data-testid="citations">
      <summary className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) cursor-pointer list-none marker:hidden select-none hover:text-(--color-accent) transition-colors inline-flex items-baseline gap-1.5">
        {t('conversation.references', { count: citations.length })}
        <span className="text-(--color-faint) group-open:rotate-90 transition-transform">›</span>
      </summary>
      <ul className="space-y-1 mt-2">
        {citations.map((c) => <CitationRow key={c.path} c={c} />)}
      </ul>
    </details>
  );
}

// CitationRow —— 点引用 = 跳到那篇 document 在 owner 站上的公开页，新标签打开。
//
// 地址由 `citationHref` 算，这里不拼。上一版是 `/${c.genre}/${c.path}`（这个文件一份、
// ChatTranscript 一份），它把体裁名当成了路由名 —— writings 的体裁是单数、路由是复数，
// 于是 prod 上那唯一一篇公开 writing 的引用点开是 404。
function CitationRow({ c }: { c: Citation }) {
  return (
    <li>
      <a
        href={citationHref(c)}
        target="_blank"
        rel="noreferrer"
        className="flex items-baseline gap-3 hover:text-(--color-accent) transition-colors"
        data-testid="citation-row"
        data-citation-path={c.path}
      >
        <span
          className={`mono text-[10px] tracking-[0.14em] uppercase tabular-nums shrink-0 ${
            c.genre === 'output' ? 'text-(--color-accent)' : 'text-(--color-muted)'
          }`}
          data-testid={`citation-genre-${c.genre}`}
        >
          {c.genre}
        </span>
        <span className="font-serif italic text-(--color-muted) text-[14.5px]">{c.title}</span>
        <span className="mono text-[10px] text-(--color-faint) ml-auto shrink-0">↗</span>
      </a>
    </li>
  );
}
