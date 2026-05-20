// ConversationsSection —— /admin/conversations。
// URL ?code=LABEL-NNN 时只显示该 code 的 conversation；admin code 卡里的
// "view conversations" 链接就走这条 query。

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ConvRow } from '@/components/admin/sections/conversations/ConvRow';
import { ConvTranscriptModal } from '@/components/admin/sections/conversations/ConvTranscriptModal';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { useConversations, type ConversationsHook } from '@/lib/admin/use-conversations';

export function ConversationsSection() {
  const params = useSearchParams();
  const filterCode = params.get('code') ?? undefined;
  const hook = useConversations(filterCode);
  return (
    <>
      <SectionHeader
        kicker="surface · sessions"
        title="conversations"
        count={`${hook.rows.length} sessions`}
      />
      <FilterChip code={filterCode} />
      <ConvHeader />
      <ConvList hook={hook} />
      {hook.transcript && (
        <ConvTranscriptModal
          transcript={hook.transcript}
          onClose={hook.closeTranscript}
        />
      )}
    </>
  );
}

function FilterChip({ code }: { code: string | undefined }) {
  return code ? (
    <div
      data-testid="conv-filter-chip"
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-3"
    >
      <span>filter · code · {code}</span>
      <Link
        href="/admin/conversations"
        className="text-(--color-faint) hover:text-(--color-accent)"
      >
        clear ×
      </Link>
    </div>
  ) : null;
}

function ConvHeader() {
  return (
    <div className="grid grid-cols-[180px_1fr_auto_auto_auto] gap-6 mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) pb-3 px-1 border-b border-(--color-rule)">
      <span>visitor</span><span>via code</span><span>turns</span><span>flags</span><span></span>
    </div>
  );
}

function ConvList({ hook }: { hook: ConversationsHook }) {
  return hook.status === 'idle' || hook.status === 'loading'
    ? <ListSkeleton count={6} />
    : <ReadyList hook={hook} />;
}

function ReadyList({ hook }: { hook: ConversationsHook }) {
  return hook.rows.length === 0
    ? <EmptyState />
    : (
      <ul>
        {hook.rows.map((c) => (
          <ConvRow
            key={c.id}
            conversation={c}
            open={hook.openId === c.id}
            onToggle={() => hook.openConversation(c.id)}
          />
        ))}
      </ul>
    );
}

function EmptyState() {
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      No conversations yet. Once visitors chat through a code or BYOAI session, you&apos;ll see them here.
    </p>
  );
}
