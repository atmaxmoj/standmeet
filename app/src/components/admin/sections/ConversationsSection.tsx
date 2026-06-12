// ConversationsSection —— /admin/conversations。design 源 admin.js
// ConversationsSection (990-1021)。ad-table (visitor / via code / turns /
// sentiment / flags / last) + click → transcript modal。
// ?code=LABEL-NNN filter 走 URL query。

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ConvRow } from '@/components/admin/sections/conversations/ConvRow';
import { ConvTranscriptModal } from '@/components/admin/sections/conversations/ConvTranscriptModal';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { useConversations, type ConversationsHook, type ConvView } from '@/lib/admin/use-conversations';

export function ConversationsSection() {
  const params = useSearchParams();
  const filterCode = params.get('code') ?? undefined;
  const hook = useConversations(filterCode);
  return (
    <>
      <SectionHeader
        kicker="access · sessions"
        title="conversations"
        count={`${hook.rows.length} sessions`}
        action={<PrivateHitsHint hook={hook} />}
      />
      <FilterChip code={filterCode} />
      <ConvTable hook={hook} />
      {hook.transcript && (
        <ConvTranscriptModal
          transcript={hook.transcript}
          onClose={hook.closeTranscript}
        />
      )}
    </>
  );
}

function PrivateHitsHint({ hook }: { hook: ConversationsHook }) {
  const count = hook.rows.filter((r) => r.private_hits > 0).length;
  return count === 0 ? null : (
    <span className="mono text-[10.5px] tracking-[0.06em] text-(--color-muted)">
      <span className="text-(--color-accent)">●</span>{' '}
      {count} session{count === 1 ? '' : 's'} hit private topics
    </span>
  );
}

function FilterChip({ code }: { code: string | undefined }) {
  return code ? (
    <div
      data-testid="conv-filter-chip"
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-3"
    >
      <span>filter · code · {code}</span>
      <Link href="/admin/conversations" className="text-(--color-faint) hover:text-(--color-accent)">
        clear ×
      </Link>
    </div>
  ) : null;
}

function isConvLoading(hook: ConversationsHook): boolean {
  return hook.status === 'idle' || hook.status === 'loading';
}

function ConvTable({ hook }: { hook: ConversationsHook }) {
  return isConvLoading(hook)
    ? <ListSkeleton count={6} />
    : <ConvTableReady hook={hook} />;
}

function ConvTableReady({ hook }: { hook: ConversationsHook }) {
  return hook.rows.length === 0 ? <EmptyState /> : <ReadyTable hook={hook} />;
}

function ReadyTable({ hook }: { hook: ConversationsHook }) {
  return (
    <table className="w-full border-collapse" data-testid="conv-table">
      <thead>
        <tr className="mono text-[9.5px] tracking-[0.2em] uppercase text-(--color-muted)">
          <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">visitor</th>
          <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">via code</th>
          <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">ip</th>
          <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">turns</th>
          <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">sentiment</th>
          <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">flags</th>
          <th className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal">last</th>
        </tr>
      </thead>
      <tbody>
        {hook.rows.map((c) => (
          <ConvTableRow key={c.id} conv={c} open={hook.openId === c.id} onToggle={() => hook.openConversation(c.id)} />
        ))}
      </tbody>
    </table>
  );
}

function ConvTableRow({ conv, open, onToggle }: { conv: ConvView; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-(--color-surface)/30">
        <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60">
          <div className="font-serif text-[15px] text-(--color-ink)">{conv.visitor}</div>
          <div className="mono text-[10px] text-(--color-faint) mt-0.5">{conv.id}</div>
        </td>
        <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[11.5px] tabular-nums text-(--color-ink)">
          {conv.code_label}
        </td>
        <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[11px] tabular-nums text-(--color-muted)" data-testid="conv-client-ip">
          {conv.client_ip}
        </td>
        <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[11.5px] tabular-nums text-(--color-muted)">
          {conv.turns}
        </td>
        <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60">
          <SentimentCell sentiment={conv.sentiment} />
        </td>
        <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60">
          <FlagsCell hits={conv.private_hits} />
        </td>
        <td className="px-1.5 py-2.5 border-b border-(--color-rule)/60 mono text-[11.5px] tabular-nums text-(--color-muted)">
          {conv.last}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="px-1.5 py-3 border-b border-(--color-rule)/60" data-testid="transcript-panel">
            <ConvRow conversation={conv} open onToggle={onToggle} />
          </td>
        </tr>
      )}
    </>
  );
}

const SENTIMENT_TONES: Record<string, string> = {
  engaged: 'text-(--color-accent)',
  warm: 'text-(--color-amber)',
  curious: 'text-(--color-muted)',
  short: 'text-(--color-faint)',
  probing: 'text-(--color-violet)',
  skeptical: 'text-(--color-muted)',
  shopping: 'text-(--color-muted)',
};

function SentimentCell({ sentiment }: { sentiment: string }) {
  const tone = SENTIMENT_TONES[sentiment] ?? 'text-(--color-faint)';
  return (
    <span className={`mono text-[9.5px] tracking-[0.14em] uppercase ${tone}`}>
      {sentiment || '—'}
    </span>
  );
}

function FlagsCell({ hits }: { hits: number }) {
  return hits > 0
    ? <span className="mono text-[10px] tracking-[0.14em] text-(--color-accent)">{hits} priv</span>
    : <span className="mono text-[10px] text-(--color-faint)">—</span>;
}

function EmptyState() {
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      No conversations yet. Once visitors chat through a code or BYOAI session, you&apos;ll see them here.
    </p>
  );
}
