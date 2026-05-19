// TerminalBox —— Setup 页面的"$ standmeet deploy ..."终端块。scanline 扫
// 描线 + corner crosshair + blink cursor = 让访客一眼看到这是个真实 self-
// host 部署，不是 SaaS 注册。
//
// host 通过 hook 拿（SSR 安全），让"ready at localhost:38127"那行显示真实。

'use client';

import { useInstanceHash } from '@/lib/auth/use-instance-hash';

export function TerminalBox() {
  const { host } = useInstanceHash();
  return (
    <div className="crosshair scanline border border-(--color-rule) bg-(--color-surface)/60 mt-8 p-4 mono text-[11.5px] leading-[1.7] text-(--color-muted) max-w-[640px]">
      <span className="ch-tl" />
      <span className="ch-br" />
      <div><span className="text-(--color-accent)">$</span> standmeet deploy</div>
      <div><span className="text-(--color-faint)">├─</span> bundling indexer + retrieval</div>
      <div><span className="text-(--color-faint)">├─</span> provisioning postgres + pgvector</div>
      <div><span className="text-(--color-faint)">├─</span> exposing mcp endpoint</div>
      <div>
        <span className="text-(--color-faint)">└─</span> ready at{' '}
        <span className="text-(--color-ink)">{host || 'localhost'}</span>
      </div>
      <div className="mt-2">
        <span className="text-(--color-accent)">$</span> awaiting first owner
        <span className="blink text-(--color-accent)">_</span>
      </div>
    </div>
  );
}
