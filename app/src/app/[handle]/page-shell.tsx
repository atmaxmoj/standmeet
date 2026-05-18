// page-shell —— /<handle> 的 client 容器。把 SSR fetch 好的 owner +
// content 接给设计稿那套：TopBar / Banners / Hero / Conversation / Insights
// / Projects / Where / Contact / Footer，dark 切换 + chat 状态在这一层管。

'use client';

import { Suspense, useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import type { PageContent, PublicOwnerView } from '@/lib/api/public';

import { Contact } from '@/components/Contact';
import { Hero } from '@/components/Hero';
import { Insights } from '@/components/Insights';
import { Projects } from '@/components/Projects';
import { Where } from '@/components/Where';
import { ByoaiBanner, CodedBanner } from '@/components/page/Banners';
import { ConversationDeck } from '@/components/page/ConversationDeck';
import { Footer } from '@/components/page/Footer';
import { TopBar } from '@/components/page/TopBar';
import { useTheme } from '@/lib/page/use-theme';
import { useConversation, pickTier, pickBanner } from '@/lib/page/use-conversation';

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
  const code = params.get('c');
  const visitor = params.get('v');
  return <PageShellBody owner={owner} content={content} byoai={byoai} code={code} visitor={visitor} />;
}

type BodyProps = {
  owner: PublicOwnerView;
  content: PageContent;
  byoai: boolean;
  code: string | null;
  visitor: string | null;
};

function PageShellBody({ owner, content, byoai, code, visitor }: BodyProps) {
  const { dark, toggle } = useTheme();
  const tier = pickTier(byoai, code);
  const conv = useConversation({ handle: owner.handle, tier });
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onAsk = useCallback((q: string) => {
    setInput('');
    void conv.ask(q);
  }, [conv]);

  const focusChat = useCallback(() => {
    inputRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar handle={owner.handle} dark={dark} onToggleDark={toggle} />
      <AccessBanner byoai={byoai} code={code} visitor={visitor} />
      <main className="flex-1">
        <div className="max-w-[760px] mx-auto px-6 lg:px-0">
          <Hero
            owner={owner}
            content={content}
            input={input}
            setInput={setInput}
            onAsk={onAsk}
            pending={conv.pending}
            inputRef={inputRef}
          />
          {conv.turns.length > 0 && (
            <ConversationDeck ownerHandle={owner.handle} turns={conv.turns} onReset={conv.reset} />
          )}
          <Insights insights={content.insights} />
          <Projects projects={content.projects} />
          <Where where={content.where} />
          <Contact contact={content.contact} onFocusChat={focusChat} />
        </div>
      </main>
      <Footer />
    </div>
  );
}

// AccessBanner —— byoai / coded / none 三档；通过 dispatch map 避开
// switch / 嵌套三元的 cyclo 累加。
function AccessBanner({ byoai, code, visitor }: { byoai: boolean; code: string | null; visitor: string | null }) {
  const map = {
    byoai: <ByoaiBanner provider="claude" />,
    coded: <CodedBanner code={code ?? ''} visitor={visitor} />,
    none: null,
  } as const;
  return map[pickBanner(byoai, code)];
}
