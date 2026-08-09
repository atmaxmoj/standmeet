// ChatTranscript —— 主 chat(ChatRoom)和浮窗(FloatingChatDock)共用的 transcript
// 渲染:you 问 + ai 答(走真 ChatMarkdown,md/latex/code 全有)+ ToolCallCards 折叠
// searched 卡 + CitationsList references。进度行(ChatProgress)是 turn 内当前动作
// (ToolThrobber reading/searching / ThinkingDots 词库轮换)。
//
// #35:浮窗以前自己写了简陋版(纯文本拼接、假 thinking、无 citations),现在两边
// 同一套组件 —— 大 chat 的渲染行为在小 chat 上也成立(同 testid:answer-body /
// tool-throbbers / citations / answer-pending)。compact 由调用方 CSS 缩。

'use client';

import { useTranslations } from 'next-intl';

import { useThinkingWord } from '@/lib/page/thinking-words';
import { ChatMarkdown } from '@/components/page/markdown';
import { ToolCallCards } from '@/components/page/ToolCallCards';
import { VisitorQuestion } from '@/components/visitor/ComposerAttachments';
import type { Citation, Dialog, ToolThrobberView } from '@/lib/page/use-chat';

export function ChatTranscript({ dialogs, onAsk, conversationID }: {
  dialogs: readonly Dialog[]; onAsk: (q: string) => void;
  conversationID?: string;
}) {
  return (
    <div className="flex-1">
      {dialogs.map((d, i) => (
        <DialogCard key={d.id ?? i} dialog={d} onAsk={onAsk} conversationID={conversationID} />
      ))}
    </div>
  );
}

function DialogCard({ dialog, onAsk, conversationID }: {
  dialog: Dialog; onAsk: (q: string) => void; conversationID?: string;
}) {
  const t = useTranslations('visitor.chatTranscript');
  return (
    <article className="pt-10 pb-10 border-b border-(--color-rule)">
      <div className="mono text-[10.5px] tracking-[0.18em] uppercase mb-3 flex items-baseline gap-3">
        <span className="text-(--color-ink)">{t('you')}</span>
      </div>
      <VisitorQuestion q={dialog.q} />
      {/* 说话人标签属于这一**轮**,不属于答案正文,所以它排在遥测和工具卡之前:读者要先知道
          是谁在说,再看这一轮做了什么(UX-31 —— 以前是 `SEARCHED n · READ m` 先出现,`AI` 在
          它下面,而这个产品的整个论点是「AI 用 owner 的声音回答」)。它也因此在 pending 期间
          就在场:AI 一开始动作就该署名。 */}
      <SpeakerLabel />
      <ToolCallCards
        calls={dialog.answer.toolCalls}
        onAsk={onAsk} conversationID={conversationID}
      />
      {dialog.pending ? null : <AnswerView answer={dialog.answer} />}
    </article>
  );
}

// ChatProgress —— turn 内「当前动作」观察者,贴在输入栏正上方。最后一条 dialog
// 还 pending 时显:有 tool → reading/searching(throbber),没 tool → thinking
// 词库轮换。turn 落地即整条消失。
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

// ToolThrobber —— agent 当前在跑那一个 tool 的进度行。label 已在 use-chat 拼好。
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

// ThinkingDots —— LLM 在想(没具体 tool)时的进度行。词每 3 秒轮换;retrying 固定显。
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

// SpeakerLabel —— 「AI」。属于这一轮,不属于答案正文(见 DialogCard 里的说明)。
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

// PartialNotice —— 「这一轮没说完」。跟正文分开渲,因为一段被截断的文字和「它被截断了」
// 是两件事;混进正文就读成了作者自己那么写的(F-A-32)。
function PartialNotice({ notice }: { notice?: string }) {
  return notice === undefined || notice === '' ? null : (
    <div
      data-testid="answer-partial-notice"
      className="mono text-[11px] tracking-[0.06em] text-(--color-accent) border-l-2 border-(--color-accent) pl-3 mt-5"
    >
      {notice}
    </div>
  );
}

// CitationsList —— 答案下一条安静的 "references · N" 折叠行(normal-AI-chat 风),
// 展开是来源列表;每条跳那篇 document 的公开页。
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
  return (
    <li>
      <a
        href={`/${c.genre}/${c.path}`}
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
