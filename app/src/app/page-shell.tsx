// page-shell —— / 根公开页的 client 容器（v1 单 owner instance）。把 SSR fetch
// 好的 owner + content 接给设计稿那套：TopBar / Banners / Hero / Conversation /
// Insights / Projects / Where / Contact / Footer，dark 切换 + chat 状态在这一层管。
//
// tier 来自 localStorage（use-gate.persistSession 写的 visitor-session），
// 不再读 URL `?byoai=1` —— flag-on-URL 是坏设计（URL 上落历史 / 截图 / 分享时
// 泄漏 + 状态边界混乱）。BYOAI 流程：visitor 在 /gate 提交 → use-gate 写
// localStorage → router.push('/') → 这里读 store → 渲染 byoai banner。

'use client';

import { useEffect, useState } from 'react';
import { useCallback, useRef } from 'react';

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
import { loadStoredSession } from '@/lib/gate/use-gate';
import { useTheme } from '@/lib/page/use-theme';
import { useConversation } from '@/lib/page/use-conversation';
import type { SessionTier } from '@/lib/page/use-conversation';

type Props = {
  owner: PublicOwnerView;
  content: PageContent;
};

export function PageShell({ owner, content }: Props) {
  return <PageShellBody owner={owner} content={content} />;
}

function PageShellBody({ owner, content }: Props) {
  const { dark, toggle } = useTheme();
  const tier = useTierFromStorage();
  const conv = useConversation({ tier });
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
      <AccessBanner tier={tier} />
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

// useTierFromStorage —— mount 后读 localStorage 拿 stored visitor-session。
// SSR 初始值是 'public'（hydration mismatch 不可见，banner 走 client only）；
// useEffect 里 syn-read 一次，有 byoai flag → 切 'byoai'，有 session 不带
// byoai → 'code'（gate 提交 access code 后存的），否则 'public'。
function useTierFromStorage(): SessionTier {
  const [tier, setTier] = useState<SessionTier>('public');
  useEffect(() => {
    const stored = loadStoredSession();
    setTier(stored ? (stored.byoai ? 'byoai' : 'code') : 'public');
  }, []);
  return tier;
}

// AccessBanner —— byoai / coded / none 三档。tier 来自 store 而非 URL flag。
function AccessBanner({ tier }: { tier: SessionTier }) {
  const map = {
    byoai: <ByoaiBanner provider="claude" />,
    code: <CodedBanner code="" visitor={null} />,
    public: null,
  } as const;
  return map[tier];
}
