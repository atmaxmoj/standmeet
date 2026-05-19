// ConvTranscriptModal —— 弹层显示一个 conversation 完整 transcript。
// transcript = { conversationID, loading, error, messages[] }。

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
    list: <MessageList messages={transcript.messages} />,
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

function MessageList({ messages }: { messages: readonly ConvTranscriptMessage[] }) {
  return (
    <ul className="space-y-6">
      {messages.map((m) => <MessageItem key={m.id} message={m} />)}
    </ul>
  );
}

function MessageItem({ message }: { message: ConvTranscriptMessage }) {
  return (
    <li>
      <MessageLabel role={message.role} at={message.created_at} />
      <MessageBody role={message.role} body={message.body} />
      <CitedTail ids={message.cited_wiki_ids} />
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

function CitedTail({ ids }: { ids: readonly string[] }) {
  return ids.length === 0 ? null : (
    <p className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) mt-2">
      grounded in {ids.length} corpus {ids.length === 1 ? 'entry' : 'entries'}
    </p>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
