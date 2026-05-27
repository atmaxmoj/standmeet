// SessionStrip —— visitor 所有 chat-capable surface (index / blog / wiki /
// output) 顶部 sticky 单一 session 指示条。
//
// 状态来源：useVisitorSessionStore（zustand + localStorage 'standmeet-session'）。
// SessionStrip 自身不知道 code 从哪来；上游 (use-absorb-code / use-gate)
// 负责 issue session 后写 store；这里订阅 + 渲染 + 自带 storage event 跨
// tab 同步。
//
// 视觉规范见 docs/design/project/sm-components.js SessionStrip + sm-tokens.css
// .sm-session-strip。无 props —— 跨 surface 复用，挂在每个 page 顶端。
// 没 active session → 不渲染。

'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import {
  bindVisitorSessionSync,
  useVisitorSessionStore,
  type VisitorSession,
} from '@/lib/visitor/session-store';

export function SessionStrip() {
  // mount 一次 bind storage / custom event listener。组件卸载 → unbind。
  useEffect(() => bindVisitorSessionSync(), []);
  const session = useVisitorSessionStore((s) => s.session);
  return session ? <SessionStripGate s={session} /> : null;
}

function SessionStripGate({ s }: { s: VisitorSession }) {
  return s.code === null && !s.byoai ? null : <SessionStripBody s={s} />;
}

function SessionStripBody({ s }: { s: VisitorSession }) {
  const view = deriveStripView(s);
  return (
    <div className={view.cls} data-testid="session-strip" data-warn={view.warn ? 'true' : undefined}>
      <StripLeft s={s} />
      <StripRight s={s} pct={view.pct} warn={view.warn} />
    </div>
  );
}

function deriveStripView(s: VisitorSession): { pct: number; warn: boolean; cls: string } {
  const pct = computePct(s);
  const warn = pct >= 80 && s.max > 0;
  return { pct, warn, cls: stripCls(s.byoai, warn) };
}

function computePct(s: VisitorSession): number {
  return s.max > 0 ? Math.min(100, (s.used / s.max) * 100) : 0;
}

function stripCls(byoai: boolean, warn: boolean): string {
  const parts = ['sm-session-strip'];
  byoai && parts.push('is-byoai');
  warn && parts.push('is-warn');
  return parts.join(' ');
}

function StripLeft({ s }: { s: VisitorSession }) {
  return (
    <div className="sm-session-strip-left">
      <span className="sm-live-dot" />
      <StripModeLabel s={s} />
      <span className="sm-session-strip-sep">·</span>
      <span className="text-(--color-muted)">
        {s.byoai ? 'public scope' : `code · ${s.code ?? ''}`}
      </span>
      <StripVisitorBadge visitor={s.visitor} />
    </div>
  );
}

function StripModeLabel({ s }: { s: VisitorSession }) {
  return s.byoai ? (
    <span className="sm-session-strip-ai-mode">
      byoai · {s.byoaiProvider}
    </span>
  ) : (
    <span className="sm-session-strip-label">
      {s.label ?? 'invited'}
    </span>
  );
}

function StripVisitorBadge({ visitor }: { visitor: string | null }) {
  return visitor ? (
    <>
      <span className="sm-session-strip-sep">·</span>
      <span className="sm-session-strip-meta">you · {visitor}</span>
    </>
  ) : null;
}

function StripRight({ s, pct, warn }: { s: VisitorSession; pct: number; warn: boolean }) {
  return (
    <div className="sm-session-strip-right">
      <StripQuotaSlot s={s} pct={pct} />
      <span className="sm-session-strip-sep">·</span>
      <StripWarnAction visible={warn && !s.byoai} />
      <Link href="/gate" className="sm-session-strip-link is-exit">
        <span data-testid="session-strip-exit">exit session</span>
      </Link>
    </div>
  );
}

function StripQuotaSlot({ s, pct }: { s: VisitorSession; pct: number }) {
  return s.byoai ? (
    <span className="sm-session-strip-gauge-text sm-session-strip-byoai-unlimited">
      visitor-paid · unlimited
    </span>
  ) : s.max > 0 ? (
    <StripGauge used={s.used} max={s.max} pct={pct} />
  ) : null;
}

function StripWarnAction({ visible }: { visible: boolean }) {
  return visible ? (
    <Link href="/gate#request" className="sm-session-strip-link is-request">
      <span data-testid="session-strip-request-more">request more ↗</span>
    </Link>
  ) : null;
}

function StripGauge({ used, max, pct }: { used: number; max: number; pct: number }) {
  return (
    <span
      className="sm-session-strip-gauge"
      title="session quota"
      data-testid="session-strip-gauge"
    >
      <span className="sm-session-strip-gauge-text">
        <span className="sm-session-strip-used">{used}</span>
        {' / '}
        <span>{max}</span>
        <span className="sm-session-strip-turns-suffix">turns</span>
      </span>
      <span className="sm-session-strip-gauge-bar">
        <SessionStripGaugeFill pct={pct} />
      </span>
    </span>
  );
}

function SessionStripGaugeFill({ pct }: { pct: number }) {
  return <span className={`sm-session-strip-gauge-fill sm-fill [--fill:${pct}%]`} />;
}
