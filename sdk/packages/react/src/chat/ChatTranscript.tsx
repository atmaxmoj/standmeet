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

import { useChatT, useT } from '../i18n.js';
import { useCitationHref } from './reader-lang.js';
import { useThinkingWord } from './thinking-words.js';
import { ChatMarkdown } from './markdown.js';
import { ToolCallCards } from './ToolCallCards.js';
import { PartialNotice } from './PartialNotice.js';
import { VisitorQuestion } from './ComposerAttachments.js';
import type { Citation, Dialog, ToolThrobberView } from './use-chat.js';
import { UNREACHABLE_CODE } from './dialog-stream.js';

export function ChatTranscript({ dialogs, onAsk, conversationID, noteEvent }: {
  dialogs: readonly Dialog[]; onAsk: (q: string) => void;
  conversationID?: string;
  // noteEvent —— what happens on the card must go into this conversation's
  // history, or the agent won't know about it on the next turn (F-B-9).
  noteEvent?: (text: string) => void;
}) {
  return (
    <div className="smc-transcript">
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
  const t = useChatT('transcript');
  return (
    <article className="smc-dialog">
      <div className="smc-dialog-you">
        <span>{t('you')}</span>
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
    <div className="smc-progress" data-testid="chat-progress">
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
      className="smc-throbber"
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
      className="smc-thinking"
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
  const t = useChatT('transcript');
  return (
    <div
      data-testid="answer-speaker"
      className="smc-speaker"
    >
      {t('ai')}
    </div>
  );
}

function AnswerView({ answer }: { answer: Dialog['answer'] }) {
  // A known error code is said in the visitor's language, in the same slot the server's sentence
  // would have taken: the whole answer when nothing streamed, the notice under a partial one.
  const known = useKnownErrorText(answer.errorCode);
  const paras = known !== null && answer.notice === undefined ? [known] : answer.paras;
  const notice = known !== null && answer.notice !== undefined ? known : answer.notice;
  return (
    <div className="smc-answer" data-testid="answer-body" data-error-code={answer.errorCode ?? ''}>
      {paras.map((p, i) => (
        <div key={i} className="reading smc-para">
          <ChatMarkdown source={p} />
        </div>
      ))}
      <PartialNotice notice={notice} />
      <CitationsList citations={answer.citations} />
    </div>
  );
}

// KEY_LOST_CODES —— the visitor's own key didn't reach the provider: this browser can't read the
// saved key (byoai_key_unreadable, caught before sending), or the server got none (byoai_key_required).
export const KEY_LOST_CODES: ReadonlySet<string> = new Set(['byoai_key_unreadable', 'byoai_key_required']);

function useKnownErrorText(code: string | undefined): string | null {
  const t = useT();
  if (code === 'rate_limited') return t('errRateLimited');
  if (code === 'too_large') return t('errTooLarge');
  if (code === UNREACHABLE_CODE) return t('errUnreachable');
  if (KEY_LOST_CODES.has(code ?? '')) return t('errKeyUnreadable');
  return null;
}

// CitationsList —— a quiet "references · N" collapsible line under the
// answer (normal-AI-chat style); expanding shows the source list, each
// linking to that document's public page.
function CitationsList({ citations }: { citations?: readonly Citation[] }) {
  const t = useChatT('transcript');
  return citations && citations.length > 0 ? (
    <details className="smc-citations" data-testid="citations">
      <summary>
        {t('references', { count: String(citations.length) })}
        <span className="smc-citations-caret">›</span>
      </summary>
      <ul className="smc-citation-list">
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
        className="smc-citation"
        data-testid="citation-row"
        data-citation-path={c.path}
      >
        <span data-testid={`citation-genre-${c.genre}`}>{c.genre}</span>
        <span className="smc-faint">·</span>
        <span>{c.title}</span>
        <span className="smc-citation-out">↗</span>
      </a>
    </li>
  );
}
