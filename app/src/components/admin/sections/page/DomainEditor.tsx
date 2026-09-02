// DomainEditor — custom domain allow-list editor (read/write wired: GET/POST/DELETE
// /allowed-domains). The "verified" badge is cosmetic — the app only tracks which
// domains are allowed; actual cert issuance (ACME) is done by the deploy provider's
// reverse proxy via /internal/tls-ask (prod-deploy dropped, not the app's job).
// **Not a DNS-TXT challenge, and not a blocked TODO** — this half of the app is
// complete; the other half is provider territory.

'use client';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  useDomain, type DomainStatus,
  domainBadge, domainHint, domainEffectiveHost,
} from '@/lib/admin/use-domain';

type Props = { handle: string };

// useVerifyInline — verify now throws; show it inline in place (a single settings
// field, so inline reads better than a fleeting toast).
function useVerifyInline(verify: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setError(null);
    try {
      await verify();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify this domain. Please try again.');
    }
  }, [verify]);
  return { error, onVerify: () => { void run(); } };
}

export function DomainEditor({ handle }: Props) {
  const d = useDomain();
  const { error, onVerify } = useVerifyInline(d.verify);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DefaultCard status={d.status} sanitized={d.domain} />
        <CustomCard hook={d} onVerify={onVerify} error={error} />
      </div>
      <EffectiveLine handle={handle} domain={d.domain} status={d.status} />
    </div>
  );
}

function currentHost(): string {
  return typeof window !== 'undefined' ? window.location.host : '';
}

function DefaultCard({
  status, sanitized,
}: { status: DomainStatus; sanitized: string }) {
  const t = useTranslations('adminPages.domain');
  const using = !sanitized || status !== 'verified';
  return (
    <div className={`border ${using ? 'border-(--color-ink)' : 'border-(--color-rule)'} p-4 rounded-sm bg-(--color-surface)/40`}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{t('defaultLabel')}</div>
        <InUseFlag shown={using} />
      </div>
      <div className="font-serif text-(--color-ink) text-[18px] font-medium tracking-[-0.005em]">
        <span className="text-(--color-accent)">{currentHost()}</span>
      </div>
      <div className="mono text-[10.5px] tracking-[0.04em] text-(--color-faint) mt-1">{t('defaultHint')}</div>
    </div>
  );
}

function InUseFlag({ shown }: { shown: boolean }) {
  const t = useTranslations('adminPages.domain');
  return shown
    ? <span className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-accent)">{t('inUse')}</span>
    : null;
}

function CustomCard({
  hook, onVerify, error,
}: { hook: ReturnType<typeof useDomain>; onVerify: () => void; error: string | null }) {
  const t = useTranslations('adminPages.domain');
  return (
    <div className={`border ${hook.status === 'verified' ? 'border-(--color-ink)' : 'border-(--color-rule)'} p-4 rounded-sm bg-(--color-surface)/40`}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{t('customLabel')}</div>
        <StatusBadge status={hook.status} hasDomain={Boolean(hook.domain)} />
      </div>
      <DomainInputRow hook={hook} />
      <DomainFootRow hook={hook} onVerify={onVerify} />
      <VerifyError message={error} />
    </div>
  );
}

// VerifyError — show a verify failure inline in place (next to the input, not a
// fleeting toast).
function VerifyError({ message }: { message: string | null }) {
  return message ? (
    <p data-testid="domain-verify-error" className="mono text-[10.5px] tracking-[0.04em] text-(--color-accent) mt-2">
      {message}
    </p>
  ) : null;
}

function DomainInputRow({ hook }: { hook: ReturnType<typeof useDomain> }) {
  const t = useTranslations('adminPages.domain');
  return (
    <div className="flex items-baseline gap-2 border-b border-(--color-rule) pb-1">
      <span className="mono text-(--color-faint)">{t('schemePrefix')}</span>
      <input
        type="text"
        value={hook.domain}
        onChange={(e) => hook.setDomain(e.target.value)}
        placeholder="yourdomain.com"
        spellCheck={false}
        autoComplete="off"
        className="flex-1 min-w-0 bg-transparent py-1.5 reading-tight text-[17px] font-medium tracking-[-0.005em]"
      />
      <ClearBtn shown={Boolean(hook.domain)} onClick={hook.reset} />
    </div>
  );
}

function ClearBtn({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  const t = useTranslations('adminPages.domain');
  return shown ? (
    <button
      type="button"
      onClick={onClick}
      className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent)"
    >
      {t('clear')}
    </button>
  ) : null;
}

function DomainFootRow({
  hook, onVerify,
}: { hook: ReturnType<typeof useDomain>; onVerify: () => void }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.04em] mt-2 flex items-baseline justify-between gap-3 flex-wrap">
      <FootHint valid={hook.valid} sanitized={hook.domain} />
      <VerifyBtn show={hook.valid && hook.status !== 'verified'} status={hook.status} onVerify={onVerify} />
    </div>
  );
}

function FootHint({ valid, sanitized }: { valid: boolean; sanitized: string }) {
  const cls = valid ? 'text-(--color-muted)' : 'text-(--color-faint)';
  return <span className={cls}>{domainHint(valid, sanitized)}</span>;
}

function VerifyBtn({
  show, status, onVerify,
}: { show: boolean; status: DomainStatus; onVerify: () => void }) {
  return show ? (
    <button
      type="button"
      onClick={onVerify}
      disabled={status === 'pending'}
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-50"
    >
      {status === 'pending' ? 'checking…' : 'verify dns ↗'}
    </button>
  ) : null;
}

function StatusBadge({
  status, hasDomain,
}: { status: DomainStatus; hasDomain: boolean }) {
  const cfg = domainBadge(status, hasDomain);
  return <span className={`mono text-[10px] tracking-[0.16em] uppercase ${cfg.cls}`}>{cfg.text}</span>;
}

function EffectiveLine({
  handle, domain, status,
}: { handle: string; domain: string; status: DomainStatus }) {
  const t = useTranslations('adminPages.domain');
  const effective = domainEffectiveHost(handle, domain, status);
  return (
    <div className="mono text-[10.5px] tracking-[0.12em] text-(--color-faint) flex items-baseline gap-2 flex-wrap">
      <span>{t('effectiveHost')}</span>
      <span className="text-(--color-ink)">{effective}</span>
      <span className="text-(--color-faint)">{t('effectiveHostNote')}</span>
    </div>
  );
}
