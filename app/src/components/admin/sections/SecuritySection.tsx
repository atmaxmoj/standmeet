// SecuritySection —— /admin/ip-bans. The owner bans source IPs (#58-5). Once banned, the public
// surface (visitor chat / session / access-request) returns 403 for that IP across the board.
// Pairs with the visitor client_ip shown in conversations: spot an abusive IP → copy it here and ban it.

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListPane } from '@/components/admin/ListPane';
import { useIPBans, type IPBansHook, type BanView } from '@/lib/admin/use-ip-bans';
import { useAction } from '@/lib/ui/use-action';
import { useEffectErrorToast } from '@/lib/ui/toast';

export function SecuritySection() {
  const hook = useIPBans();
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader
        kicker="settings · security"
        slug="ip-bans"
        count={hook.status === 'ready' ? `${hook.bans.length}` : ''}
      />
      <Intro />
      <BanForm onBan={hook.banIP} />
      <BansBody hook={hook} />
    </>
  );
}

const monoTag = (chunks: ReactNode) => <span className="mono text-(--color-ink)">{chunks}</span>;

function Intro() {
  const t = useTranslations('adminShell.ipBans');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t.rich('intro', { mono: monoTag })}
    </p>
  );
}

function BanForm({ onBan }: { onBan: IPBansHook['banIP'] }) {
  const t = useTranslations('adminShell.ipBans');
  const [ip, setIP] = useState('');
  const [reason, setReason] = useState('');
  const run = useAction();
  const clearForm = useCallback(() => { setIP(''); setReason(''); }, []);
  // Only clear the inputs on success: clearForm runs after onBan resolves and before run's catch
  // — if it throws, the inputs stay so the owner can retry.
  const submit = useCallback(() => run(
    () => onBan({ ip: ip.trim(), reason: reason.trim() }).then(clearForm),
    { success: 'IP banned' },
  ), [ip, reason, onBan, run, clearForm]);
  return (
    <div className="flex flex-wrap items-end gap-3 mb-7" data-testid="ban-form">
      <Field label="ip address" value={ip} onChange={setIP} placeholder="203.0.113.7" testid="ban-ip" />
      <Field label="reason" value={reason} onChange={setReason} placeholder="optional note" testid="ban-reason" />
      <button
        type="button"
        data-testid="ban-submit"
        disabled={ip.trim() === ''}
        onClick={() => void submit()}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {t('banIp')}
      </button>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, testid,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; testid: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{label}</span>
      <input
        className="sm-field-input min-w-[200px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
      />
    </label>
  );
}

// BansBody —— this page's empty state is the single most dangerous-direction sentence in all of
// admin: "No IPs banned. The public surface is open." Printing it on a failed fetch means
// answering the owner's "who did I ban" with "no one, and the door is open."
// The three outcomes are handed to ListPane to sort out (F-N-7).
function BansBody({ hook }: { hook: IPBansHook }) {
  return (
    <ListPane status={hook.status} count={hook.bans.length} empty={<EmptyBans />}>
      <BansList hook={hook} />
    </ListPane>
  );
}

function BansList({ hook }: { hook: IPBansHook }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="ip-bans-list">
      {hook.bans.map((b) => (
        <li key={b.id} data-testid={`ban-row-${b.ip}`}>
          <BanRow ban={b} onUnban={hook.unbanIP} />
        </li>
      ))}
    </ul>
  );
}

function EmptyBans() {
  const t = useTranslations('adminShell.ipBans');
  return (
    <p className="reading italic text-(--color-muted)" data-testid="ip-bans-list">
      {t('empty')}
    </p>
  );
}

function BanRow({ ban, onUnban }: { ban: BanView; onUnban: IPBansHook['unbanIP'] }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border border-(--color-rule) rounded-[3px] px-4 py-3">
      <span className="min-w-0">
        <span className="mono text-(--color-ink) text-[14px]">{ban.ip}</span>
        {ban.reason && (
          <span className="reading-tight text-[13px] text-(--color-muted) ml-3">{ban.reason}</span>
        )}
      </span>
      <UnbanBtn ban={ban} onUnban={onUnban} />
    </div>
  );
}

function UnbanBtn({ ban, onUnban }: { ban: BanView; onUnban: IPBansHook['unbanIP'] }) {
  // One-click unban → run wraps it up: success toasts, failure reports (no longer silent —
  // the owner must know when the unban didn't take).
  const t = useTranslations('adminShell.ipBans');
  const run = useAction();
  const handle = useCallback(
    () => run(() => onUnban(ban.id), { success: 'IP unbanned' }),
    [onUnban, ban.id, run],
  );
  return (
    <button
      type="button"
      data-testid={`unban-${ban.ip}`}
      onClick={() => void handle()}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent) shrink-0"
    >
      {t('unban')}
    </button>
  );
}
