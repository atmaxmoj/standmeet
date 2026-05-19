// ConversationsSection —— /admin/conversations。
// backend 还没暴露 listing —— 渲染空态："0 sessions"。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ConvRow } from '@/components/admin/sections/conversations/ConvRow';
import { ConvTranscriptModal } from '@/components/admin/sections/conversations/ConvTranscriptModal';
import { useConversations, type ConversationsHook } from '@/lib/admin/use-conversations';

export function ConversationsSection() {
  const hook = useConversations();
  return (
    <>
      <SectionHeader
        kicker="surface · sessions"
        title="conversations"
        count={`${hook.rows.length} sessions`}
      />
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

function ConvHeader() {
  return (
    <div className="grid grid-cols-[180px_1fr_auto_auto_auto] gap-6 mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) pb-3 px-1 border-b border-(--color-rule)">
      <span>visitor</span><span>via code</span><span>turns</span><span>flags</span><span></span>
    </div>
  );
}

function ConvList({ hook }: { hook: ConversationsHook }) {
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
