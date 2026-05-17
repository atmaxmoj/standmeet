// page-shell —— [handle]/page 的 client 容器。
//
// 拿 SSR fetch 好的 owner + content，提供 onAsk callback：把问题塞进 chat
// pending queue，让 ChatDock 接到后自动发送 + 滚动到聊天区。

'use client';

import { useCallback, useState } from 'react';

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
  const [pending, setPending] = useState<string | null>(null);
  const onAsk = useCallback((q: string) => setPending(q), []);
  const onConsumePending = useCallback(() => setPending(null), []);
  return (
    <main>
      <Hero owner={owner} content={content} onAsk={onAsk} />
      <Insights insights={content.insights} />
      <Projects projects={content.projects} />
      <Where where={content.where} />
      <Contact contact={content.contact} />
      <ChatDock handle={owner.handle} pendingQuestion={pending} onConsumePending={onConsumePending} />
    </main>
  );
}
