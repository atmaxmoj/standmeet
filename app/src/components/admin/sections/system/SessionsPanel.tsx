// SessionsPanel —— /admin/system: every place the owner is currently signed in.
// Shows each active session's device, IP and age, marks the current one, and lets
// the owner revoke any other from here (the per-session counterpart to sign-out).
// Revoking the current session goes through the normal signOut() flow.
//
// Modeled on the session card in the youteacher auth UI (device row + current
// badge + per-session revoke), ported to this product's panel + ListPane idiom.

'use client';

import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import { signOut } from '@/lib/admin/sign-out';
import { useSessions, deviceLabel, type SessionRow } from '@/lib/admin/use-sessions';
import { ago, stampMinute } from '@/lib/ui/format-time';
import { useAction } from '@/lib/ui/use-action';

export function SessionsPanel() {
  const t = useTranslations('adminShell.system');
  const { sessions, status, reload, revoke } = useSessions();
  const run = useAction();
  const onRevoke = (id: string) => void run(
    async () => { await revoke(id); reload(); },
    { success: t('sessionsRevoked') },
  );
  return (
    <div
      className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 lg:col-span-2"
      data-testid="system-sessions"
    >
      <AdminSectionHead className="mb-3">{t('sessions')}</AdminSectionHead>
      <ListPane
        status={status}
        count={sessions.length}
        empty={
          <div className="mono text-[11px] text-(--color-faint)" data-testid="sessions-empty">
            {t('sessionsEmpty')}
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          {sessions.map((s) => <SessionRowView key={s.id} row={s} onRevoke={onRevoke} />)}
        </div>
      </ListPane>
    </div>
  );
}

function SessionRowView({ row, onRevoke }: { row: SessionRow; onRevoke: (id: string) => void }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 border-b border-(--color-rule)/50 pb-2"
      data-testid={`session-row-${row.id}`}
      data-current={row.current ? 'true' : 'false'}
    >
      <SessionInfo row={row} />
      <SessionAction row={row} onRevoke={onRevoke} />
    </div>
  );
}

function SessionInfo({ row }: { row: SessionRow }) {
  const t = useTranslations('adminShell.system');
  return (
    <div className="min-w-0">
      <div className="font-serif text-[15px] text-(--color-ink) flex items-baseline gap-2">
        {deviceLabel(row.user_agent)}
        {row.current
          ? <span className="mono text-[9px] tracking-[0.14em] uppercase text-(--color-accent)" data-testid="session-current">{t('sessionsCurrent')}</span>
          : null}
      </div>
      <div className="mono text-[11px] text-(--color-muted) tabular-nums" title={stampMinute(row.created_at)}>
        {ipLabel(row.ip_address, t('sessionsUnknownIp'))} · {ago(row.created_at)}
      </div>
    </div>
  );
}

function ipLabel(ip: string, unknown: string): string {
  return ip === '' ? unknown : ip;
}

function SessionAction({ row, onRevoke }: { row: SessionRow; onRevoke: (id: string) => void }) {
  const t = useTranslations('adminShell.system');
  return row.current
    ? (
      <button
        type="button"
        className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-accent) hover:underline shrink-0"
        data-testid="session-signout-here"
        onClick={() => void signOut()}
      >
        {t('sessionsSignOutHere')}
      </button>
    )
    : (
      <button
        type="button"
        className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) hover:text-(--color-accent) shrink-0"
        data-testid={`session-revoke-${row.id}`}
        onClick={() => onRevoke(row.id)}
      >
        {t('sessionsRevoke')}
      </button>
    );
}
