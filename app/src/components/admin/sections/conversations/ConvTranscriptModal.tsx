// ConvTranscriptModal —— 弹层显示一个 conversation 完整 transcript。
// 每条 assistant message 下面挂 "cited · output/wiki · <title>" 列表，
// title 通过 wikiRefs/outputRefs 索引按 message.cited_*_ids 查到。

'use client';

import { ModalShell } from '@/components/admin/modals/ModalShell';
import {
  pickTranscriptState,
  type ConvTranscript,
  type ConvTranscriptMessage,
} from '@/lib/admin/use-conversations';

type Props = {
  transcript: ConvTranscript;
  onClose: () => void;
};

export function ConvTranscriptModal({ transcript, onClose }: Props) {
  return (
    <ModalShell
      onClose={onClose}
      kicker="conversation"
      title={`transcript · ${transcript.conversationID.slice(0, 8)}`}
      maxWidth={720}
    >
      <div className="px-7 py-6" data-testid="transcript-body">
        <TranscriptBody transcript={transcript} />
      </div>
    </ModalShell>
  );
}

function TranscriptBody({ transcript }: { transcript: ConvTranscript }) {
  const map = {
    loading: <Loading />,
    error: <ErrorBlock message={transcript.error ?? ''} />,
    empty: <EmptyState />,
    list: (
      <MessageList
        messages={transcript.messages}
        wikiRefs={transcript.wikiRefs}
        outputRefs={transcript.outputRefs}
      />
    ),
  } as const;
  return map[pickTranscriptState(transcript)];
}

function Loading() {
  return <p className="reading-tight italic text-(--color-muted)">loading transcript…</p>;
}

function ErrorBlock({ message }: { message: string }) {
  return <p className="mono text-[11px] text-(--color-accent)">{message}</p>;
}

function EmptyState() {
  return (
    <p className="reading-tight italic text-(--color-muted)">
      No messages in this conversation.
    </p>
  );
}

function MessageList({
  messages, wikiRefs, outputRefs,
}: {
  messages: readonly ConvTranscriptMessage[];
  wikiRefs: Record<string, string>;
  outputRefs: Record<string, string>;
}) {
  return (
    <ul className="space-y-6">
      {messages.map((m) => (
        <MessageItem key={m.id} message={m} wikiRefs={wikiRefs} outputRefs={outputRefs} />
      ))}
    </ul>
  );
}

function MessageItem({
  message, wikiRefs, outputRefs,
}: {
  message: ConvTranscriptMessage;
  wikiRefs: Record<string, string>;
  outputRefs: Record<string, string>;
}) {
  return (
    <li>
      <MessageLabel role={message.role} at={message.created_at} />
      <MessageBody role={message.role} body={message.body} />
      <CitedTail
        wikiIds={message.cited_wiki_ids}
        outputIds={message.cited_output_ids}
        wikiRefs={wikiRefs}
        outputRefs={outputRefs}
      />
    </li>
  );
}

function MessageBody({ role, body }: { role: 'visitor' | 'assistant'; body: string }) {
  const isVisitor = role === 'visitor';
  return (
    <p
      className="reading text-(--color-ink) mt-2"
      style={{
        fontSize: isVisitor ? '20px' : '16.5px',
        fontStyle: isVisitor ? 'italic' : 'normal',
        fontWeight: 380,
      }}
    >
      {body}
    </p>
  );
}

function MessageLabel({ role, at }: { role: 'visitor' | 'assistant'; at: string }) {
  const text = role === 'visitor' ? 'visitor' : 'ai';
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase flex items-baseline gap-3">
      <span className={role === 'visitor' ? 'text-(--color-ink)' : 'text-(--color-accent)'}>
        {text}
      </span>
      <span className="text-(--color-faint) normal-case tracking-[0.06em]">
        · {formatTime(at)}
      </span>
    </div>
  );
}

// CitedTail —— output 排前面（"polished, quote verbatim"，跟 visitor chat
// 优先级一致）。如果某个 id 在 refs 索引里找不到 title（数据脏 / 已删除）
// 就跳过那条 —— 显示 "<missing>" 比让 UI 整块崩好，但实际上很难触发。
function CitedTail({
  wikiIds, outputIds, wikiRefs, outputRefs,
}: {
  wikiIds: readonly string[];
  outputIds: readonly string[];
  wikiRefs: Record<string, string>;
  outputRefs: Record<string, string>;
}) {
  const items = [
    ...outputIds.map((id) => ({ kind: 'output' as const, id, title: outputRefs[id] })),
    ...wikiIds.map((id) => ({ kind: 'wiki' as const, id, title: wikiRefs[id] })),
  ].filter((c) => c.title);
  return items.length === 0 ? null : (
    <ul
      className="mt-2 space-y-0.5 mono text-[10px] tracking-[0.12em] uppercase"
      data-testid="transcript-cited"
    >
      {items.map((c) => (
        <li key={`${c.kind}:${c.id}`} className="flex items-baseline gap-2">
          <span className={c.kind === 'output' ? 'text-(--color-accent)' : 'text-(--color-faint)'}>
            cited · {c.kind}
          </span>
          <span className="reading-tight italic text-(--color-muted) normal-case tracking-[0.04em]">
            {c.title}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
