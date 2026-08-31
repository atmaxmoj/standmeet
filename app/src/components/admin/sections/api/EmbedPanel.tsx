// EmbedPanel —— 把这台实例的 chat 放到**别人的网站**上要写的那两行。
//
// **为什么这一块要存在**：CLAUDE.md 承诺 embed 是"单个 `<script>` 标签 drop-in"，
// 而在这一块之前，owner 在产品里找不到那个标签长什么样 —— 而 `/embed.js` 当时还是 404
// （2026-08-30 实测）。承诺写在文档里、包构建得出来、中间那一段不存在。
//
// 地址是**运行时算的**，不是写死的：owner 的实例装在他自己的域名上，写死 localhost
// 的话他复制走的那段代码在自己站点上根本不指向他。而 e2e 就从这段代码里把 src
// 取出来再去访问它 —— 一个"我们记得有个 /embed.js"式的断言，路径改了就悄悄验错东西
// （[[ref-resolves-not-a-string]]）。

'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

// EMBED_PATH —— 由 app/public/embed.js 发出（scripts/copy-embed-bundle.mjs 搬进去的），
// next.config 的 headers 给它开了跨源。
const EMBED_PATH = '/embed.js';

export function EmbedPanel() {
  const t = useTranslations('adminIntegrations.embed');
  const [origin, setOrigin] = useState('');
  // 在浏览器里才知道这台实例对外是什么地址。SSR 时留空，渲染成相对路径也仍然正确。
  useEffect(() => { setOrigin(window.location.origin); }, []);
  return (
    <section>
      <h2 className="font-serif text-(--color-ink) text-[22px] font-medium tracking-[-0.012em] mb-2">
        {t('heading')}
      </h2>
      <p className="reading-tight text-(--color-muted) text-[15px] max-w-[54em] mb-3">
        {t('blurb')}
      </p>
      <pre
        data-testid="embed-snippet"
        className="mono text-[12px] text-(--color-ink) bg-(--color-rule)/20 border border-(--color-rule) rounded-[3px] p-3 overflow-x-auto"
      >{snippet(origin)}</pre>
    </section>
  );
}

// snippet —— owner 复制走的那两行。第二行同等重要：只给一个 <script>，
// 他还是不知道接下来在页面上写什么。
function snippet(origin: string): string {
  return [
    `<script src="${origin}${EMBED_PATH}"></script>`,
    `<standmeet-chat base-url="${origin}" mode="public"></standmeet-chat>`,
  ].join('\n');
}
