// DomainEditor —— custom domain + DNS verify badge。
// backend 暂未暴露 allowed_domains 写入，verify 是 client-side stub。

'use client';

import {
  useDomain, type DomainStatus,
  domainBadge, domainHint, domainEffectiveHost,
} from '@/lib/admin/use-domain';

type Props = { handle: string };

export function DomainEditor({ handle }: Props) {
  const d = useDomain();
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DefaultCard status={d.status} sanitized={d.domain} />
        <CustomCard hook={d} />
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
  const using = !sanitized || status !== 'verified';
  return (
    <div className={`border ${using ? 'border-(--color-ink)' : 'border-(--color-rule)'} p-4 rounded-sm bg-(--color-surface)/40`}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">default</div>
        <InUseFlag shown={using} />
      </div>
      <div className="font-serif text-(--color-ink) text-[18px] font-medium tracking-[-0.005em]">
        <span className="text-(--color-accent)">{currentHost()}</span>
      </div>
      <div className="mono text-[10.5px] tracking-[0.04em] text-(--color-faint) mt-1">no setup · always available</div>
    </div>
  );
}

function InUseFlag({ shown }: { shown: boolean }) {
  return shown
    ? <span className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-accent)">● in use</span>
    : null;
}

function CustomCard({ hook }: { hook: ReturnType<typeof useDomain> }) {
  return (
    <div className={`border ${hook.status === 'verified' ? 'border-(--color-ink)' : 'border-(--color-rule)'} p-4 rounded-sm bg-(--color-surface)/40`}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">custom domain</div>
        <StatusBadge status={hook.status} hasDomain={Boolean(hook.domain)} />
      </div>
      <DomainInputRow hook={hook} />
      <DomainFootRow hook={hook} />
    </div>
  );
}

function DomainInputRow({ hook }: { hook: ReturnType<typeof useDomain> }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-(--color-rule) pb-1">
      <span className="mono text-(--color-faint)">https://</span>
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
  return shown ? (
    <button
      type="button"
      onClick={onClick}
      className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent)"
    >
      clear
    </button>
  ) : null;
}

function DomainFootRow({ hook }: { hook: ReturnType<typeof useDomain> }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.04em] mt-2 flex items-baseline justify-between gap-3 flex-wrap">
      <FootHint valid={hook.valid} sanitized={hook.domain} />
      <VerifyBtn show={hook.valid && hook.status !== 'verified'} status={hook.status} onVerify={hook.verify} />
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
  const effective = domainEffectiveHost(handle, domain, status);
  return (
    <div className="mono text-[10.5px] tracking-[0.12em] text-(--color-faint) flex items-baseline gap-2 flex-wrap">
      <span>effective share host ·</span>
      <span className="text-(--color-ink)">{effective}</span>
      <span className="text-(--color-faint)">· used by code share links, QRs, gate footer.</span>
    </div>
  );
}
