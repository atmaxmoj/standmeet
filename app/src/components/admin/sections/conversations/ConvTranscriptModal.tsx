// ConvTranscriptModal — modal showing one conversation's full transcript.
// Each assistant message carries a "cited · <genre> · <title>" list below it: **all four
// genres are included** (output / wiki / subjectivity / writing); title is looked up by
// the id in `message.cited[genre]` against the `transcript.refs[genre]` index. This used
// to recognize only wiki and output, so a reply citing 6 subjectivity notes showed zero
// citations on the owner's transcript (F-A-39).

'use client';

import { useTranslations } from 'next-intl';

import { ModalShell } from '@/components/admin/modals/ModalShell';
import { DiagramDiagnostics } from '@/components/page/diagram-diagnostics';
import { ChatMarkdown } from '@/components/page/markdown';
import {
  deriveGhostView,
  pickTranscriptState,
  type CitedGenre,
  type ConvTranscript,
  type ConvTranscriptMessage,
  type GhostLog,
} from '@/lib/admin/use-conversations';
import { stampMinute } from '@/lib/ui/format-time';

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
        <GroundingBlock titles={transcript.grounding} />
        <GhostsBlock ghosts={transcript.ghosts} />
      </div>
    </ModalShell>
  );
}

function TranscriptBody({ transcript }: { transcript: ConvTranscript }) {
  const map = {
    loading: <Loading />,
    error: <ErrorBlock message={transcript.error ?? ''} />,
    empty: <EmptyState />,
    list: <MessageList messages={transcript.messages} refs={transcript.refs} />,
  } as const;
  return map[pickTranscriptState(transcript)];
}

function Loading() {
  const t = useTranslations('adminAccess');
  return <p className="reading-tight italic text-(--color-muted)">{t('transcript.loading')}</p>;
}

function ErrorBlock({ message }: { message: string }) {
  return <p className="mono text-[11px] text-(--color-accent)">{message}</p>;
}

function EmptyState() {
  const t = useTranslations('adminAccess');
  return (
    <p className="reading-tight italic text-(--color-muted)">
      {t('transcript.empty')}
    </p>
  );
}

function MessageList({
  messages, refs,
}: {
  messages: readonly ConvTranscriptMessage[];
  refs: Record<CitedGenre, Record<string, string>>;
}) {
  return (
    <ul className="space-y-6">
      {messages.map((m) => <MessageItem key={m.id} message={m} refs={refs} />)}
    </ul>
  );
}

function MessageItem({
  message, refs,
}: {
  message: ConvTranscriptMessage;
  refs: Record<CitedGenre, Record<string, string>>;
}) {
  return message.role === 'event' ? (
    <li><EventLine body={message.body} at={message.created_at} /></li>
  ) : (
    <li>
      <MessageLabel role={message.role} at={message.created_at} />
      <MessageBody role={message.role} body={message.body} />
      <CitedTail cited={message.cited} refs={refs} />
    </li>
  );
}

// EVENT_PREFIX — the prefix the event body carries (the model uses it to recognize this
// as something that happened, not something someone said). The owner-side label already
// says the same thing, so the body text doesn't need to repeat it.
const EVENT_PREFIX = '[card action] ';

// EVENT_LABEL — like the neighboring `visitor` / `ai`, this is a **small mono label**,
// not a sentence: this family of labels is terminal-style metadata in the design
// language — only reading all three together tells you "who/what" — so they share
// one class and, like the others, stay untranslated.
const EVENT_LABEL = 'card action';

// EventLine — **something that happened** in this conversation: the visitor clicked
// cancel on a sandbox card / sent a confirmation email (F-B-9). It has no speaker, so
// it isn't laid out as a question-answer turn — a vertical bar + small mono text,
// visibly distinct from visitor / ai. The previous version rendered it as an assistant
// message, so the transcript read as if "AI" said this line — a line the AI never said.
function EventLine({ body, at }: { body: string; at: string }) {
  return (
    <div data-testid="conv-event-line" className="border-l-2 border-(--color-faint) pl-3 py-1">
      <div className="mono text-[10px] tracking-[0.18em] uppercase flex items-baseline gap-3">
        <span className="text-(--color-muted)">{EVENT_LABEL}</span>
        <span className="text-(--color-faint) normal-case tracking-[0.06em]">
          · {stampMinute(at)}
        </span>
      </div>
      <p className="mono text-[11px] leading-[1.6] text-(--color-muted) mt-1 break-words">
        {body.startsWith(EVENT_PREFIX) ? body.slice(EVENT_PREFIX.length) : body}
      </p>
    </div>
  );
}

// MessageBody — the visitor's question is plain text, rendered as-is; the AI's answer
// is markdown, rendered through **the same renderer as the visitor side**. The previous
// version stuffed both into <p>{body}</p>, so the owner read raw `## Heading` `**bold**`
// source, while the same body rendered fine in visitor chat and the report page (F-C-8).
// Reusing ChatMarkdown here instead of writing another one is the fix — "one body,
// four renderers" was the bug itself.
function MessageBody({ role, body }: { role: 'visitor' | 'assistant'; body: string }) {
  return role === 'visitor' ? (
    <p className="reading sm-measure text-(--color-ink) mt-2 font-[380] text-[20px] italic">{body}</p>
  ) : (
    <div className="reading sm-measure text-(--color-ink) mt-2 font-[380] text-[16.5px] not-italic">
      {/* This is where the owner reviews the transcript — a diagram compile error must
          show up **here**. The same renderer on the visitor side hides it (the body
          still stands on its own), but the problem can't just disappear: the owner
          is the only one who can fix the prompt / the skill. */}
      <DiagramDiagnostics><ChatMarkdown source={body} /></DiagramDiagnostics>
    </div>
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
        · {stampMinute(at)}
      </span>
    </div>
  );
}

// CITED_ORDER — display order: output comes first ("polished, quote verbatim", matching
// visitor chat's priority), then wiki, then the owner's own two genres. **All four
// genres are included**: this used to have only wiki and output, so a reply citing
// 6 subjectivity notes showed zero citations on the transcript (F-A-39).
const CITED_ORDER: readonly CitedGenre[] = ['output', 'wiki', 'subjectivity', 'writing'];

// CitedTail — which items a reply cited; all four genres go through **the one** render
// path (a second copy is exactly how the next genre gets missed). If an id has no title
// in the refs index (dirty data / already deleted), that item is skipped — better than
// showing "<missing>" and crashing the whole UI block, though this is rare in practice.
function CitedTail({
  cited, refs,
}: {
  cited: Record<CitedGenre, readonly string[]>;
  refs: Record<CitedGenre, Record<string, string>>;
}) {
  const t = useTranslations('adminAccess');
  const items = CITED_ORDER.flatMap((kind) =>
    cited[kind].map((id) => ({ kind, id, title: refs[kind][id] })),
  ).filter((c) => c.title);
  return items.length === 0 ? null : (
    <ul
      className="mt-2 space-y-0.5 mono text-[10px] tracking-[0.12em] uppercase"
      data-testid="transcript-cited"
    >
      {items.map((c) => (
        <li key={`${c.kind}:${c.id}`} className="flex items-baseline gap-2">
          <span className={c.kind === 'output' ? 'text-(--color-accent)' : 'text-(--color-faint)'}>
            {t('transcript.cited', { kind: c.kind })}
          </span>
          <span className="reading-tight italic text-(--color-muted) normal-case tracking-[0.04em]">
            {c.title}
          </span>
        </li>
      ))}
    </ul>
  );
}


// GroundingBlock — subjectivity notes that shaped this conversation but never made it
// into the visitor-facing citation footnotes (F-A-27).
//
// Why this block exists: subjectivity is designed to "shape the voice, not be cited" —
// that's intentional — but the other side assumes "what was read" is always carried by
// citation footnotes. Put the two together and the owner wrote a pile of standpoint
// notes to set the tone, yet no interface ever shows they were involved. This block is
// that missing observation point.
//
// Renders **titles only**: the owner needs to judge which notes are in play; the
// private body doesn't need to be copied here (the backend doesn't send it either).
// Kept separate from CITED rather than merged into one list — these aren't citations,
// and merging them would make it look like visitors can see them too.
function GroundingBlock({ titles }: { titles: readonly string[] }) {
  const t = useTranslations('adminAccess');
  return titles.length === 0 ? null : (
    <section
      className="mt-8 pt-6 border-t border-(--color-rule)"
      data-testid="transcript-grounding"
    >
      <h3 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
        {t('transcript.groundingTitle')}
      </h3>
      <ul className="space-y-0.5 mono text-[10px] tracking-[0.12em] uppercase">
        {titles.map((title) => (
          <li key={title} className="flex items-baseline gap-2">
            <span className="text-(--color-faint)">{t('transcript.grounded')}</span>
            <span className="reading-tight italic text-(--color-muted) normal-case tracking-[0.04em]">
              {title}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// GhostsBlock — H.13.e: owner-side observation of the ghost text log. Only code
// conversations have entries; other modes get an empty array → the whole block
// doesn't render. Each row: text · source · shown_at · accepted? (a check + time
// when accepted, otherwise a grey dash).
function GhostsBlock({ ghosts }: { ghosts: readonly GhostLog[] }) {
  const t = useTranslations('adminAccess');
  return ghosts.length === 0 ? null : (
    <section className="mt-8 pt-6 border-t border-(--color-rule)" data-testid="transcript-ghosts">
      <h3 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
        {t('transcript.ghostsTitle')}
      </h3>
      <ul className="space-y-2">
        {ghosts.map((s) => (
          <GhostRow key={s.id} log={s} />
        ))}
      </ul>
    </section>
  );
}

function GhostRow({ log }: { log: GhostLog }) {
  const v = deriveGhostView(log);
  return (
    <li
      className="flex items-baseline gap-3 text-[13px]"
      data-testid="transcript-ghost-row"
      data-source={log.source}
      data-accepted={v.acceptedAttr}
    >
      <span className={`mono text-[9.5px] tracking-[0.12em] uppercase shrink-0 ${v.sourceCls}`}>
        {log.source}
      </span>
      <span className="reading-tight italic text-(--color-ink) flex-1">
        &ldquo;{log.ghost_text}&rdquo;
      </span>
      <span className="mono text-[10px] text-(--color-faint) shrink-0">
        {v.acceptedMark}
      </span>
    </li>
  );
}
