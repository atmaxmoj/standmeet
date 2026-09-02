// SandboxPanel — #147 admin panel for the MCP sandbox: lists active per-session
// workspaces + a one-click sweep of expired ones. Backend is sandboxws.Manager +
// cron sweep (#148); this is the owner-authed admin surface. Data via
// /api/admin/sandbox/*. Sweep is an owner-triggered cleanup (on-demand, outside cron).

'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import { useSandbox, type SandboxWorkspace } from '@/lib/admin/use-sandbox';
import type { ResourceStatus } from '@/lib/state/status';
import { useAction } from '@/lib/ui/use-action';

export function SandboxPanel() {
  const t = useTranslations('adminShell.sandbox');
  const sandbox = useSandbox();
  const run = useAction();
  const onSweep = useCallback(
    () => run(() => sandbox.sweep(), { success: 'Swept expired sandbox workspaces' }),
    [run, sandbox],
  );
  return (
    <div
      className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 lg:col-span-2"
      data-testid="sandbox-panel"
    >
      {/* Title uses AdminSectionHead (12px + vermillion bar) — the same skeleton as the
          six main sections under api·mcp. This card used to be a bare 10px mono div,
          same size as a field name, so scanning the page gave no cue "a new section
          starts here". */}
      {/* The sweep button sits at the right end of the title rule (`aside`) — it used to
          start its own flex row outside the title, so the rule only drew up to the
          button and didn't span full-width like the other five cards on this page.
          **It's disabled when there are no workspaces** (F-E-26): a button that's always
          clickable but sometimes does nothing teaches "no effect" as normal (same family
          as F-C-24's painted-on CONNECT, F-D-13's dock button visitors can't see). The
          reason isn't only on the title either — a disabled button may not even get
          hover events; the empty state below (`sandbox-empty`) already says "none right
          now, and when there will be". */}
      <AdminSectionHead
        className="mb-3"
        aside={
          <button
            className="sm-btn sm-btn-outline sm-btn-sm" type="button"
            data-testid="sandbox-sweep" onClick={onSweep}
            disabled={sandbox.workspaces.length === 0}
            title={sandbox.workspaces.length === 0 ? t('sweepNothing') : undefined}
          >
            {t('sweepNow')}
          </button>
        }
      >
        {t('title', { n: sandbox.workspaces.length })}
      </AdminSectionHead>
      <WorkspaceBody rows={sandbox.workspaces} status={sandbox.status} />
    </div>
  );
}

// WorkspaceBody — the three states go through ListPane (F-L-53).
//
// The empty state here is the most explicit in this family: its hint reads
// **"None here means none in use — not that something is broken."**
// On a GET 500, that's exactly the message shown — "not broken". So it may only
// appear once the fetch has **actually** succeeded.
function WorkspaceBody({ rows, status }: {
  rows: readonly SandboxWorkspace[]; status: ResourceStatus;
}) {
  const t = useTranslations('adminShell.sandbox');
  return (
    <ListPane
      status={status}
      count={rows.length}
      empty={
        <div className="sm-empty" data-testid="sandbox-empty">
          <div className="sm-empty-title">{t('empty')}</div>
          <p className="sm-empty-hint">{t('emptyHint')}</p>
        </div>
      }
    >
      <WorkspaceTable rows={rows} />
    </ListPane>
  );
}

function WorkspaceTable({ rows }: { rows: readonly SandboxWorkspace[] }) {
  const t = useTranslations('adminShell.sandbox');
  return (
    <table className="w-full mono text-[11px]" data-testid="sandbox-table">
      <thead className="text-(--color-faint)">
        <tr className="text-left">
          <th className="py-1 font-normal">{t('colWorkspace')}</th>
          <th className="py-1 font-normal text-right">{t('colAge')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((w) => <WorkspaceRow key={w.id} ws={w} />)}
      </tbody>
    </table>
  );
}

function WorkspaceRow({ ws }: { ws: SandboxWorkspace }) {
  const t = useTranslations('adminShell.sandbox');
  return (
    <tr className="border-t border-(--color-rule)/40">
      <td className="py-1 text-(--color-muted)">{ws.id}</td>
      <td className="py-1 text-right text-(--color-muted) tabular-nums">{t('ageSecs', { n: ws.age_secs })}</td>
    </tr>
  );
}
