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
import { useTranslations } from 'next-intl';

import {
  bindVisitorSessionSync,
  useVisitorSessionStore,
  type VisitorSession,
} from '@/lib/visitor/session-store';
import { validateVisitorSession } from '@/lib/visitor/validate-session';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import { cssVars } from '@/lib/ui/css-vars';

export function SessionStrip() {
  // mount 一次 bind storage / custom event listener。组件卸载 → unbind。
  // F-L-11: 同时探一下 stored token 还活着没(TTL 过期 → 401 → 清两个 store),
  // 免得读者页拿着死 session 显假「unlocked」chrome + 空正文。
  useEffect(() => {
    void validateVisitorSession();
    return bindVisitorSessionSync();
  }, []);
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
      <StripVisitorBadge s={s} />
    </div>
  );
}

function StripModeLabel({ s }: { s: VisitorSession }) {
  const t = useTranslations('visitor.sessionStrip');
  return s.byoai ? (
    <span className="sm-session-strip-ai-mode">
      {t('byoaiMode', { provider: s.byoaiProvider })}
    </span>
  ) : (
    <span className="sm-session-strip-label">
      {s.label ?? 'invited'}
    </span>
  );
}

function StripVisitorBadge({ s }: { s: VisitorSession }) {
  return s.visitor ? (
    <>
      <span className="sm-session-strip-sep">·</span>
      <StripVisitorName s={s} />
    </>
  ) : null;
}

// StripVisitorName —— code 模式下名字可点 = 换人:重开名字选择器,取新名字 =
// 新 member = 新对话(同名则续上)。byoai 无 member 概念 → 纯文字不可点。
function StripVisitorName({ s }: { s: VisitorSession }) {
  const t = useTranslations('visitor.sessionStrip');
  const you = t('you', { visitor: s.visitor ?? '' });
  return s.code === null ? (
    <span className="sm-session-strip-meta">{you}</span>
  ) : (
    <button
      type="button"
      className="sm-session-strip-meta sm-session-strip-switch"
      data-testid="session-strip-switch-name"
      title="switch name — chat as someone else"
      onClick={() => { usePendingCodeStore.getState().setCode(s.code ?? ''); }}
    >
      {you}
    </button>
  );
}

function StripRight({ s, pct, warn }: { s: VisitorSession; pct: number; warn: boolean }) {
  const t = useTranslations('visitor.sessionStrip');
  return (
    <div className="sm-session-strip-right">
      <StripQuotaSlot s={s} pct={pct} />
      <StripNamesSlot s={s} />
      <span className="sm-session-strip-sep">·</span>
      <StripWarnAction visible={warn && !s.byoai} />
      <Link href="/gate" className="sm-session-strip-link is-exit">
        <span data-testid="session-strip-exit">{t('exit')}</span>
      </Link>
    </div>
  );
}

function StripQuotaSlot({ s, pct }: { s: VisitorSession; pct: number }) {
  const t = useTranslations('visitor.sessionStrip');
  return s.byoai ? (
    <span className="sm-session-strip-gauge-text sm-session-strip-byoai-unlimited">
      {t('byoaiUnlimited')}
    </span>
  ) : s.max > 0 ? (
    <StripGauge used={s.used} max={s.max} pct={pct} />
  ) : null;
}

// StripNamesSlot —— 这张码有名字上限时显 "N / M names"(几个人用了 / 共几个)。
function StripNamesSlot({ s }: { s: VisitorSession }) {
  const t = useTranslations('visitor.sessionStrip');
  return s.maxMembers > 0 ? (
    <>
      <span className="sm-session-strip-sep">·</span>
      <span className="sm-session-strip-gauge-text" data-testid="session-strip-names">
        <span className="sm-session-strip-used">{s.memberCount}</span>
        {' / '}{s.maxMembers}
        <span className="sm-session-strip-turns-suffix">{t('names')}</span>
      </span>
    </>
  ) : null;
}

function StripWarnAction({ visible }: { visible: boolean }) {
  const t = useTranslations('visitor.sessionStrip');
  return visible ? (
    <Link href="/gate#request" className="sm-session-strip-link is-request">
      <span data-testid="session-strip-request-more">{t('requestMore')}</span>
    </Link>
  ) : null;
}

function StripGauge({ used, max, pct }: { used: number; max: number; pct: number }) {
  const t = useTranslations('visitor.sessionStrip');
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
        <span className="sm-session-strip-turns-suffix">{t('turns')}</span>
      </span>
      <span className="sm-session-strip-gauge-bar">
        <SessionStripGaugeFill pct={pct} />
      </span>
    </span>
  );
}

// 填充比例走 `style`：拼接出来的 Tailwind 任意属性构建期扫不到，一条 CSS 都不生成，
// `.sm-fill` 会一直退到兜底的 `width: 0%` —— 访客看到的配额条就永远是空的。
function SessionStripGaugeFill({ pct }: { pct: number }) {
  return (
    <span
      className="sm-session-strip-gauge-fill sm-fill"
      // eslint-disable-next-line no-restricted-syntax -- pct 是这次会话用掉的比例，运行时才知道
      style={cssVars({ '--fill': `${pct}%` })}
    />
  );
}
