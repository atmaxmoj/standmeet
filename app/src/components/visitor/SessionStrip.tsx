// SessionStrip —— the single sticky session indicator bar at the top of
// every chat-capable visitor surface (index / blog / wiki / output).
//
// State source: useVisitorSessionStore (zustand + localStorage
// 'standmeet-session'). SessionStrip itself doesn't know where the code
// came from; the upstream code (use-absorb-code / use-gate) is responsible
// for writing to the store after issuing a session — this component
// subscribes + renders + wires up its own storage event for cross-tab sync.
//
// Visual spec: docs/design/project/sm-components.js SessionStrip +
// sm-tokens.css .sm-session-strip. No props — reused across surfaces,
// mounted at the top of every page. No active session → doesn't render.

'use client';

import { useEffect, type ReactNode } from 'react';
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

// Slots —— a surface can slot **its own** header content into this
// already-existing strip, instead of stacking a second full-width bar on
// top of it.
//
// The chat screen used to stack two full-width bars: one for this
// **conversation's** state, one for this **site's** identity
// (`STANDMEET / sijie ● LIVE … FULL PAGE →`). Two different things, same
// shape, both full-width, both small mono text, adding up to a 68px header
// the visitor had to get past before reaching any content — and each bar
// drew its own live dot, saying the same signal twice (UX-53).
//
// The other seven surfaces that mount this strip don't pass these two
// slots, and their rendering is unchanged.
interface StripSlots {
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function SessionStrip(slots: StripSlots = {}) {
  // Bind the storage / custom event listener once on mount. Component
  // unmounts → unbind.
  // F-L-11: also probes whether the stored token is still alive (TTL
  // expired → 401 → clear both stores), so the reader page doesn't hold a
  // dead session and show a false "unlocked" chrome over an empty body.
  useEffect(() => {
    void validateVisitorSession();
    return bindVisitorSessionSync();
  }, []);
  const session = useVisitorSessionStore((s) => s.session);
  return session ? <SessionStripGate s={session} slots={slots} /> : null;
}

function SessionStripGate({ s, slots }: { s: VisitorSession; slots: StripSlots }) {
  return s.code === null && !s.byoai ? null : <SessionStripBody s={s} slots={slots} />;
}

function SessionStripBody({ s, slots }: { s: VisitorSession; slots: StripSlots }) {
  const view = deriveStripView(s);
  return (
    <div className={view.cls} data-testid="session-strip" data-warn={view.warn ? 'true' : undefined}>
      <StripLeft s={s} leading={slots.leading} />
      <StripRight s={s} pct={view.pct} warn={view.warn} trailing={slots.trailing} />
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

function StripLeft({ s, leading }: { s: VisitorSession; leading?: ReactNode }) {
  return (
    <div className="sm-session-strip-left">
      {leading}
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

// StripVisitorName —— in code mode, the name is clickable = switch person:
// reopens the name picker, and taking a new name = a new member = a new
// conversation (the same name resumes it). byoai has no concept of a
// member → plain unclickable text.
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

function StripRight({ s, pct, warn, trailing }: {
  s: VisitorSession; pct: number; warn: boolean; trailing?: ReactNode;
}) {
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
      {trailing}
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

// StripNamesSlot —— when this code has a member cap, shows "N / M names"
// (how many people have used it / how many total).
function StripNamesSlot({ s }: { s: VisitorSession }) {
  const t = useTranslations('visitor.sessionStrip');
  return s.maxMembers > 0 ? (
    <>
      <span className="sm-session-strip-sep">·</span>
      <span className="sm-session-strip-gauge-text" data-testid="session-strip-names">
        {/* Name count and turn count look alike (same class), but they're
            **two** distinct quantities, each needing to be individually
            targetable. The consequence of sharing one class name:
            `.sm-session-strip-used` would match two elements at once, and
            neither could be located. Appearance belongs to the class name,
            identity belongs to the testid. */}
        <span className="sm-session-strip-used" data-testid="session-strip-members-used">
          {s.memberCount}
        </span>
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
        <span className="sm-session-strip-used" data-testid="session-strip-turns-used">{used}</span>
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

// The fill percentage goes through `style`: a string-concatenated Tailwind
// arbitrary property can't be scanned at build time, so no CSS gets
// generated for it, and `.sm-fill` would always fall back to `width: 0%` —
// the visitor would see a quota bar that's forever empty.
function SessionStripGaugeFill({ pct }: { pct: number }) {
  return (
    <span
      className="sm-session-strip-gauge-fill sm-fill"
      // eslint-disable-next-line no-restricted-syntax -- pct is this session's used ratio, only known at runtime
      style={cssVars({ '--fill': `${pct}%` })}
    />
  );
}
