// ChatDock —— 公开页底部的访客 chat 入口。
//
// 渲染语义（设计稿 Chat 段）：
//   - transcript 流式，visitor Q 是 mono 小标题，assistant 是 serif 长段
//   - sticky input dock 在底部，上方淡出让对话从下面读上去
//   - streaming 时光标 ▍ + thinking dots 等待
//   - assistant message 走 Markdown 渲染（rehypeRaw 允许 inline html）
//   - done 后展示 cited_wiki_ids 数量（接 wiki landing 后变可点链接）
//
// 业务逻辑（session lazy 创建、stream 累加、错误兜底）都在
// @/lib/chat/use-chat-dock；本文件只组装 JSX。

'use client';

import { useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';

import {
  useChatDock,
  useExternalQuestion,
  type ChatMsg,
} from '@/lib/chat/use-chat-dock';

type Props = {
  handle: string;
  pendingQuestion: string | null;
  onConsumePending: () => void;
};

export function ChatDock({ handle, pendingQuestion, onConsumePending }: Props) {
  const state = useChatDock(handle);
  useExternalQuestion(pendingQuestion, onConsumePending, state.send);
  return (
    <div className="fixed inset-x-0 bottom-0 input-dock pt-12">
      <div className="mx-auto max-w-2xl px-6 pb-6">
        <ChatTranscript messages={state.messages} error={state.error} />
        <ChatInput
          value={state.input}
          onChange={state.setInput}
          onSubmit={state.handleSend}
          disabled={state.sending}
        />
      </div>
    </div>
  );
}

function ChatTranscript({ messages, error }: { messages: ChatMsg[]; error: string | null }) {
  return (
    <div className="space-y-6 max-h-[40vh] overflow-y-auto mb-4">
      {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
      {error && <p className="mono text-sm text-(--color-accent)">{error}</p>}
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  return msg.role === 'visitor'
    ? <VisitorBubble content={msg.content} />
    : <AssistantBubble msg={msg} />;
}

function VisitorBubble({ content }: { content: string }) {
  return (
    <div>
      <span className="smallcaps mb-1 block">you asked</span>
      <p className="mono text-sm">{content}</p>
    </div>
  );
}

function AssistantBubble({ msg }: { msg: ChatMsg & { role: 'assistant' } }) {
  return (
    <div>
      <AssistantLabel streaming={msg.streaming} />
      <AssistantBody content={msg.content} streaming={msg.streaming} />
      <AssistantCited streaming={msg.streaming} cited={msg.cited} />
    </div>
  );
}

function AssistantLabel({ streaming }: { streaming: boolean }) {
  return <span className="smallcaps mb-1 block">{streaming ? 'thinking' : 'reply'}</span>;
}

function AssistantCited({ streaming, cited }: { streaming: boolean; cited: readonly string[] }) {
  const show = !streaming && cited.length > 0;
  return show ? <CitedFootnote count={cited.length} /> : null;
}

function AssistantBody({ content, streaming }: { content: string; streaming: boolean }) {
  const showDots = content === '' && streaming;
  return showDots ? <ThinkingDots /> : <AssistantMarkdown content={content} streaming={streaming} />;
}

function AssistantMarkdown({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <div className={streaming ? 'reading caret' : 'reading'}>
      <ReactMarkdown rehypePlugins={[rehypeRaw]}>{content}</ReactMarkdown>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="mono text-(--color-muted)">
      <span className="dot">·</span>
      <span className="dot">·</span>
      <span className="dot">·</span>
    </span>
  );
}

function CitedFootnote({ count }: { count: number }) {
  return (
    <p className="smallcaps mt-2" data-testid="cited">
      grounded in {count} corpus {count === 1 ? 'entry' : 'entries'}
    </p>
  );
}

function submitWith(e: React.KeyboardEvent<HTMLTextAreaElement>, onSubmit: () => void) {
  e.preventDefault();
  onSubmit();
}

function ChatInput({
  value, onChange, onSubmit, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const onKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isSubmit = e.key === 'Enter' && !e.shiftKey;
    isSubmit && submitWith(e, onSubmit);
  }, [onSubmit]);
  return (
    <div className="flex items-end gap-3 border-t border-(--color-rule) pt-3" data-testid="chat-input">
      <textarea
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        placeholder={disabled ? 'thinking...' : 'ask something'}
        disabled={disabled}
        className="flex-1 bg-transparent reading text-base resize-none"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        className="mono text-sm text-(--color-accent) disabled:text-(--color-faint)"
      >
        send
      </button>
    </div>
  );
}
