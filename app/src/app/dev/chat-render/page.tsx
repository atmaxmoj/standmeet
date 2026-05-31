// /dev/chat-render —— ChatMarkdown 渲染夹具页面 (dev-only)。
// e2e 用 query param 切换不同 fixture，验各 markdown 语法是否被正确
// 渲染 + sanitize 拦截 raw HTML。
//
// 不走真后端，纯前端渲染管线 (跟 ConversationDeck 复用同一 ChatMarkdown
// 组件)。

'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ChatMarkdown } from '@/components/page/markdown';
import { fixtureFor } from '@/app/dev/chat-render/fixtures';

function RenderInner(): React.ReactElement {
  const params = useSearchParams();
  const key = params.get('fixture') ?? 'markdown';
  const source = fixtureFor(key);
  return (
    <main className="p-6 max-w-3xl mx-auto reading text-[18px]">
      <h1 className="text-lg mono mb-3">/dev/chat-render?fixture={key}</h1>
      <div data-testid="render-out">
        <ChatMarkdown source={source} />
      </div>
    </main>
  );
}

export default function ChatRenderPage(): React.ReactElement {
  return (
    <Suspense fallback={<p>loading…</p>}>
      <RenderInner />
    </Suspense>
  );
}
