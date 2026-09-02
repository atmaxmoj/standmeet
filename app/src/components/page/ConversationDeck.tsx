// ConversationDeck —— an inline, accumulating Q/A stream, one card per Dialog:
//   you · HH:MM
//   <serif italic question>
//   alice's ai
//   <answer body  OR  retrieving · · ·>
//   <citations list>
//
// This is the "main performance" of the public-page chat — after asking, the
// visitor doesn't get scrolled off into a modal; the answer accumulates
// inline on the page, on the same vertical reading flow as the Hero, matching
// the design spec's "transcript flow, not alternating bubbles."
//
// Naming (G-1.5): Turn → Dialog; Citation.kind → genre, Citation.id → path.

'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

import { useCitationHref } from '@/lib/corpus/use-corpus-href';
import { ChatMarkdown } from '@/components/page/markdown';
import { DeckHeader } from '@/components/page/DeckHeader';
import { ToolCallCards } from '@/components/page/ToolCallCards';
import { PartialNotice } from '@/components/visitor/PartialNotice';
import { useThinkingWord } from '@/lib/page/thinking-words';
import type { Answer, Citation, Dialog, ToolThrobberView } from '@/lib/page/use-chat';

type Props = {
  ownerHandle: string;
  dialogs: Dialog[];
  // onAsk —— I.1: a button click inside an ask_visitor card goes through
  // this to submit the selected option as the next turn; omit → the
  // ask_visitor card doesn't render (feature disabled).
  onAsk?: (q: string) => void;
  // conversationID —— #122: this conversation's id, attached when BookCard
  // sends a booking confirmation.
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
  // The throbber is a live observation of the agent: it only shows the one
  // tool the agent is running right now, and disappears the moment the turn
  // lands (use-chat clears it to null); the collapsed "searched" card inside
  // AnswerOrError serves as the persistent receipt instead. Never stack
  // multiple throbbers, and never freeze one in the transcript next to the
  // answer.
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

// ToolThrobber —— the progress line for the one tool the agent is currently
// running. The label is already assembled in use-chat from
// name+args+backend progress_label; name feeds the `tool-throbber-<name>`
// testid. tool is null (nothing running / turn landed) → renders nothing.
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

// Thinking —— the progress line for when the LLM is thinking (no specific
// tool running). The word rotates from the thinking-words vocabulary every
// 3 seconds; while retrying (backend retrying a transient LLM failure) it
// pins to "retrying". A tool running (currentTool≠null) → renders nothing:
// ToolThrobber already shows reading/searching, and there should only ever
// be one progress indicator at a time, so a document read doesn't also show
// thinking alongside it.
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

// CitationRow —— clicking a citation jumps to that document's public page on
// the owner's site, opened in a new tab.
//
// The address is computed by `citationHref`, not assembled here. The
// previous version was `/${c.genre}/${c.path}` (one copy in this file, one
// in ChatTranscript), which treated the genre name as the route name —
// writings' genre is singular but its route is plural, so the one publicly
// published writing in prod produced a 404 when its citation was clicked.
function CitationRow({ c }: { c: Citation }) {
  const href = useCitationHref();
  return (
    <li>
      <a
        href={href(c)}
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
