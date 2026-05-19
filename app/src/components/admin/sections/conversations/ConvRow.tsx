// ConvRow —— 单个会话行 + 可展开 transcript。

import type { ConvTurn, ConvView } from '@/lib/admin/use-conversations';

type Props = {
  conversation: ConvView;
  open: boolean;
  onToggle: () => void;
};

export function ConvRow({ conversation, open, onToggle }: Props) {
  return (
    <li className="border-b border-(--color-rule)/70">
      <RowToggle conversation={conversation} open={open} onToggle={onToggle} />
      <RowExpanded shown={open} transcript={conversation.transcript} />
    </li>
  );
}

function RowToggle({ conversation, open, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full grid grid-cols-[180px_1fr_auto_auto_auto] gap-6 items-baseline py-4 text-left hover:bg-(--color-surface)/40 transition-colors px-1"
    >
      <RowVisitor visitor={conversation.visitor} last={conversation.last} />
      <RowCode codeLabel={conversation.code_label} code={conversation.code} />
      <span className="mono text-[11px] tabular-nums text-(--color-muted)">{conversation.turns} turns</span>
      <RowPrivate hits={conversation.private_hits} />
      <Arrow open={open} />
    </button>
  );
}

function RowVisitor({ visitor, last }: { visitor: string; last: string }) {
  return (
    <div>
      <div className="font-serif text-(--color-ink) text-[16px]">{visitor}</div>
      <div className="mono text-[10px] tracking-[0.12em] text-(--color-faint) mt-0.5">{last}</div>
    </div>
  );
}

function RowCode({ codeLabel, code }: { codeLabel: string; code: string }) {
  return (
    <div className="mono text-[11px] tracking-[0.08em] text-(--color-muted)">
      via <span className="text-(--color-ink)">{codeLabel}</span>
      <span className="text-(--color-faint) mx-1.5">·</span>
      <span className="text-(--color-faint)">{code}</span>
    </div>
  );
}

function RowPrivate({ hits }: { hits: number }) {
  return hits > 0
    ? <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent)">{hits} private hit{hits > 1 ? 's' : ''}</span>
    : <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint)">—</span>;
}

function Arrow({ open }: { open: boolean }) {
  return (
    <span className={`mono text-[12px] text-(--color-muted) transition-transform ${open ? 'rotate-90 text-(--color-accent)' : ''}`}>
      →
    </span>
  );
}

function RowExpanded({
  shown, transcript,
}: { shown: boolean; transcript?: readonly ConvTurn[] }) {
  return shown
    ? <TranscriptBox transcript={transcript ?? []} />
    : null;
}

function TranscriptBox({ transcript }: { transcript: readonly ConvTurn[] }) {
  return transcript.length === 0
    ? (
      <div className="px-1 py-6 bg-(--color-surface)/30 fadein mono text-[11px] text-(--color-muted)">
        transcript not loaded · placeholder for now
      </div>
    ) : (
      <div className="px-1 pt-3 pb-8 bg-(--color-surface)/30 fadein">
        {transcript.map((t, i) => <TurnRow key={i} turn={t} />)}
      </div>
    );
}

function TurnRow({ turn }: { turn: ConvTurn }) {
  const role = turn.who === 'ai' ? "owner's ai" : 'visitor';
  const tone = turn.who === 'ai' ? 'text-(--color-accent)' : 'text-(--color-ink)';
  return (
    <div className="grid grid-cols-[100px_1fr] gap-5 py-2.5 border-b border-(--color-rule)/40 last:border-0">
      <div className={`mono text-[10px] tracking-[0.16em] uppercase ${tone}`}>{role}</div>
      <div className="reading-tight text-(--color-ink) text-[15.5px]">{turn.text}</div>
    </div>
  );
}
