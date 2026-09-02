// ConversationsSection —— /admin/conversations. Design source: admin.js
// ConversationsSection (990-1021). ad-table (visitor / via code / turns /
// sentiment / flags / last) + click → transcript modal.
// ?code=LABEL-NNN filter goes through the URL query.

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { ListPane } from '@/components/admin/ListPane';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { ConvTranscriptModal } from '@/components/admin/sections/conversations/ConvTranscriptModal';
import { GhostTelemetryPanel } from '@/components/admin/sections/conversations/GhostTelemetryPanel';
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
        slug="conversations"
        count={`${hook.rows.length} sessions`}
        action={<PrivateHitsHint hook={hook} />}
      />
      <FilterChip code={filterCode} />
      <GhostTelemetryPanel />
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
  const t = useTranslations('adminAccess');
  const count = hook.rows.filter((r) => r.private_hits > 0).length;
  return count === 0 ? null : (
    <span className="mono text-[10.5px] tracking-[0.06em] text-(--color-muted)">
      <span className="text-(--color-accent)">{'●'}</span>{' '}
      {t('conversations.privateHits', { count })}
    </span>
  );
}

function FilterChip({ code }: { code: string | undefined }) {
  const t = useTranslations('adminAccess');
  return code ? (
    <div
      data-testid="conv-filter-chip"
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-3"
    >
      <span>{t('conversations.filterChip', { code })}</span>
      <Link href="/admin/conversations" className="text-(--color-faint) hover:text-(--color-accent)">
        {t('conversations.clear')}
      </Link>
    </div>
  ) : null;
}

function ConvTable({ hook }: { hook: ConversationsHook }) {
  return (
    <ListPane
      status={hook.status}
      count={hook.rows.length}
      empty={<EmptyState />}
      skeleton={<ListSkeleton count={6} />}
    >
      <ReadyTable hook={hook} />
    </ListPane>
  );
}

const HEAD_KEYS = [
  'thVisitor', 'thViaCode', 'thIp', 'thTurns', 'thSentiment', 'thFlags', 'thLast',
] as const;

function ReadyTable({ hook }: { hook: ConversationsHook }) {
  const t = useTranslations('adminAccess');
  return (
    <table className="w-full border-collapse" data-testid="conv-table">
      <thead>
        <tr className="mono text-[9.5px] tracking-[0.2em] uppercase text-(--color-muted)">
          {HEAD_KEYS.map((k) => (
            <th
              key={k}
              className="text-left px-1.5 py-2 border-b border-(--color-rule) font-normal"
            >
              {t(`conversations.${k}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {hook.rows.map((c) => (
          <ConvTableRow key={c.id} conv={c} onToggle={() => hook.openConversation(c.id)} />
        ))}
      </tbody>
    </table>
  );
}

function ConvTableRow({ conv, onToggle }: { conv: ConvView; onToggle: () => void }) {
  return (
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
    ? <PrivFlag hits={hits} />
    : <span className="mono text-[10px] text-(--color-faint)">—</span>;
}

function PrivFlag({ hits }: { hits: number }) {
  const t = useTranslations('adminAccess');
  return (
    <span className="mono text-[10px] tracking-[0.14em] text-(--color-accent)">
      {t('conversations.privFlag', { hits })}
    </span>
  );
}

function EmptyState() {
  const t = useTranslations('adminAccess');
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      {t('conversations.empty')}
    </p>
  );
}
