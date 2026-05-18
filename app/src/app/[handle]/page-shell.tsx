// page-shell —— [handle]/page 的 client 容器。
//
// 拿 SSR fetch 好的 owner + content，提供 onAsk callback：把问题塞进 chat
// pending queue，让 ChatDock 接到后自动发送 + 滚动到聊天区。

'use client';

import { Suspense, useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import type { PageContent, PublicOwnerView } from '@/lib/api/public';

import { ChatDock } from '@/components/ChatDock';
import { Contact } from '@/components/Contact';
import { Hero } from '@/components/Hero';
import { Insights } from '@/components/Insights';
import { Projects } from '@/components/Projects';
import { Where } from '@/components/Where';

type Props = {
  owner: PublicOwnerView;
  content: PageContent;
};

export function PageShell({ owner, content }: Props) {
  return (
    <Suspense fallback={null}>
      <PageShellWithParams owner={owner} content={content} />
    </Suspense>
  );
}

function PageShellWithParams({ owner, content }: Props) {
  const params = useSearchParams();
  const byoai = params.get('byoai') === '1';
  return <PageShellBody owner={owner} content={content} byoai={byoai} />;
}

function PageShellBody({
  owner, content, byoai,
}: { owner: PublicOwnerView; content: PageContent; byoai: boolean }) {
  const [pending, setPending] = useState<string | null>(null);
  const onAsk = useCallback((q: string) => setPending(q), []);
  const onConsumePending = useCallback(() => setPending(null), []);
  return (
    <main>
      <BYOAIBanner show={byoai} />
      <Hero owner={owner} content={content} onAsk={onAsk} />
      <Insights insights={content.insights} />
      <Projects projects={content.projects} />
      <Where where={content.where} />
      <Contact contact={content.contact} />
      <ChatDock handle={owner.handle} pendingQuestion={pending} onConsumePending={onConsumePending} />
    </main>
  );
}

function BYOAIBanner({ show }: { show: boolean }) {
  return show ? (
    <div
      className="border-b border-(--color-rule) bg-(--color-surface) px-6 py-2"
      data-testid="byoai-banner"
    >
      <p className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) text-center">
        chatting with your own API key · public slice of corpus only
      </p>
    </div>
  ) : null;
}
