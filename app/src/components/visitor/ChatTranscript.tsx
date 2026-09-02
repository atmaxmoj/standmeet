// ChatTranscript —— the transcript rendering shared by the main chat
// (ChatRoom) and the floating dock (FloatingChatDock): you-question + ai-
// answer (through real ChatMarkdown — md/latex/code all supported) +
// ToolCallCards' collapsible searched card + CitationsList references. The
// progress line (ChatProgress) is the "current action within this turn"
// observer (ToolThrobber reading/searching / ThinkingDots word rotation).
//
// #35: the floating dock used to have its own crude implementation (plain
// text concatenation, fake thinking, no citations) — now both sides share
// one set of components, so the big chat's rendering behavior holds on the
// small chat too (same testids: answer-body / tool-throbbers / citations /
// answer-pending). compact is shrunk via the caller's CSS.

'use client';

import { useTranslations } from 'next-intl';

import { useCitationHref } from '@/lib/corpus/use-corpus-href';
import { useThinkingWord } from '@/lib/page/thinking-words';
import { ChatMarkdown } from '@/components/page/markdown';
import { ToolCallCards } from '@/components/page/ToolCallCards';
import { PartialNotice } from '@/components/visitor/PartialNotice';
import { VisitorQuestion } from '@/components/visitor/ComposerAttachments';
import type { Citation, Dialog, ToolThrobberView } from '@/lib/page/use-chat';

export function ChatTranscript({ dialogs, onAsk, conversationID, noteEvent }: {
  dialogs: readonly Dialog[]; onAsk: (q: string) => void;
  conversationID?: string;
  // noteEvent —— what happens on the card must go into this conversation's
  // history, or the agent won't know about it on the next turn (F-B-9).
  noteEvent?: (text: string) => void;
}) {
  return (
    <div className="flex-1">
      {dialogs.map((d, i) => (
        <DialogCard
          key={d.id ?? i} dialog={d} onAsk={onAsk}
          conversationID={conversationID} noteEvent={noteEvent}
        />
      ))}
    </div>
  );
}

function DialogCard({ dialog, onAsk, conversationID, noteEvent }: {
  dialog: Dialog; onAsk: (q: string) => void; conversationID?: string;
  noteEvent?: (text: string) => void;
}) {
  const t = useTranslations('visitor.chatTranscript');
  return (
    <article className="pt-10 pb-10 border-b border-(--color-rule)">
      <div className="mono text-[10.5px] tracking-[0.18em] uppercase mb-3 flex items-baseline gap-3">
        <span className="text-(--color-ink)">{t('you')}</span>
      </div>
      <VisitorQuestion q={dialog.q} />
      {/* The speaker label belongs to this **turn**, not to the answer body,
          so it comes before the telemetry and tool cards: the reader needs
          to know who's speaking before seeing what this turn did (UX-31 —
          it used to be `SEARCHED n · READ m` appearing first with `AI`
          below it, while this product's whole thesis is "AI answers in the
          owner's voice"). It's therefore also present during pending: the AI
          should be credited the moment it starts acting. */}
      <SpeakerLabel />
      <ToolCallCards
        calls={dialog.answer.toolCalls}
        onAsk={onAsk} conversationID={conversationID} noteEvent={noteEvent}
      />
      {dialog.pending ? null : <AnswerView answer={dialog.answer} />}
    </article>
  );
}

// ChatProgress —— the "current action within this turn" observer, sitting
// right above the input bar. Shows while the last dialog is still pending:
// with a tool → reading/searching (throbber), without one → thinking word
// rotation. The whole line disappears once the turn lands.
export function ChatProgress({ dialogs }: { dialogs: readonly Dialog[] }) {
  const last = dialogs.at(-1);
  return last !== undefined && last.pending ? <ProgressLine dialog={last} /> : null;
}

function ProgressLine({ dialog }: { dialog: Dialog }) {
  return (
    <div className="px-6 lg:px-0 pb-1 text-left" data-testid="chat-progress">
      {dialog.currentTool !== null
        ? <ToolThrobber tool={dialog.currentTool} />
        : <ThinkingDots retrying={dialog.retrying} tool={null} />}
    </div>
  );
}

// ToolThrobber —— the progress line for the one tool the agent is currently
// running. The label is already assembled in use-chat.
function ToolThrobber({ tool }: { tool: ToolThrobberView | null }) {
  return tool === null ? null : (
    <div
      data-testid="tool-throbbers"
      className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mb-3"
    >
      <span data-testid={`tool-throbber-${tool.name}`}>
        {tool.label}
        <span className="sm-dot">·</span>
        <span className="sm-dot">·</span>
        <span className="sm-dot">·</span>
      </span>
    </div>
  );
}

// ThinkingDots —— the progress line while the LLM is thinking (no specific
// tool). The word rotates every 3 seconds; retrying always shows.
function ThinkingDots({ retrying, tool }: { retrying: boolean; tool: ToolThrobberView | null }) {
  const word = useThinkingWord();
  return tool !== null ? null : (
    <div
      className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mt-3"
      data-testid="answer-pending"
      data-retrying={String(retrying)}
    >
      {retrying ? 'retrying' : word}{' '}
      <span className="sm-dot">·</span><span className="sm-dot">·</span><span className="sm-dot">·</span>
    </div>
  );
}

// SpeakerLabel —— "AI". Belongs to this turn, not to the answer body (see
// the note in DialogCard).
function SpeakerLabel() {
  const t = useTranslations('visitor.chatTranscript');
  return (
    <div
      data-testid="answer-speaker"
      className="mono text-[10.5px] tracking-[0.18em] uppercase text-(--color-accent) mb-3"
    >
      {t('ai')}
    </div>
  );
}

function AnswerView({ answer }: { answer: Dialog['answer'] }) {
  return (
    <div data-testid="answer-body">
      {answer.paras.map((p, i) => (
        <div key={i} className="reading mb-4 last:mb-0 text-[18px]">
          <ChatMarkdown source={p} />
        </div>
      ))}
      <PartialNotice notice={answer.notice} />
      <CitationsList citations={answer.citations} />
    </div>
  );
}

// CitationsList —— a quiet "references · N" collapsible line under the
// answer (normal-AI-chat style); expanding shows the source list, each
// linking to that document's public page.
function CitationsList({ citations }: { citations?: readonly Citation[] }) {
  const t = useTranslations('visitor.chatTranscript');
  return citations && citations.length > 0 ? (
    <details className="group mt-6" data-testid="citations">
      <summary className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) cursor-pointer list-none marker:hidden select-none hover:text-(--color-accent) transition-colors inline-flex items-baseline gap-1.5">
        {t('references', { count: String(citations.length) })}
        <span className="text-(--color-faint) group-open:rotate-90 transition-transform">›</span>
      </summary>
      <ul className="flex flex-col gap-1 mt-2">
        {citations.map((c) => <CitationRow key={c.path} c={c} />)}
      </ul>
    </details>
  ) : null;
}

function CitationRow({ c }: { c: Citation }) {
  const href = useCitationHref();
  return (
    <li>
      <a
        href={href(c)}
        target="_blank"
        rel="noreferrer"
        className="mono text-[11px] text-(--color-muted) hover:text-(--color-accent) transition-colors flex items-baseline gap-2"
        data-testid="citation-row"
        data-citation-path={c.path}
      >
        <span data-testid={`citation-genre-${c.genre}`}>{c.genre}</span>
        <span className="text-(--color-faint)">·</span>
        <span>{c.title}</span>
        <span className="text-[10px] text-(--color-faint) ml-auto">↗</span>
      </a>
    </li>
  );
}
