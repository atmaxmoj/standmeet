// TasksPeriodic —— the periodic schedule: each job's cadence, last + next run, last result, a
// Run-now button, and its recent-run history (UTC minute stamps, for a copyable audit trail).

'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import {
  tasksDetailStore, periodicView, type Periodic, type PeriodicView,
} from '@/lib/admin/use-tasks';
import type { ResourceStatus } from '@/lib/state/status';
import { useAction } from '@/lib/ui/use-action';

const LABEL = 'mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-muted)';

export function TasksPeriodic({ periodic }: { periodic: { status: ResourceStatus; data: Periodic[] } }) {
  const t = useTranslations('adminShell.tasks');
  return (
    <div className="mb-9">
      <AdminSectionHead className="mb-3">{t('periodicHeading')}</AdminSectionHead>
      <ListPane
        status={periodic.status}
        count={periodic.data.length}
        empty={<p className="text-(--color-muted) text-[15px] reading-tight">{t('periodicEmpty')}</p>}
      >
        <ul className="flex flex-col gap-3">
          {periodic.data.map((p) => <PeriodicRow key={p.name} v={periodicView(p)} />)}
        </ul>
      </ListPane>
    </div>
  );
}

function PeriodicRow({ v }: { v: PeriodicView }) {
  const t = useTranslations('adminShell.tasks');
  const run = useAction();
  const runNow = useCallback(
    () => run(() => tasksDetailStore.getState().runPeriodic(v.name), { success: t('runNowQueued') }),
    [run, v.name, t],
  );
  return (
    <li data-testid="periodic-row" data-name={v.name} className="border border-(--color-rule) rounded-[3px] p-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="mono text-[12px] text-(--color-ink)">{v.name}</span>
        <span className="mono text-[11px] text-(--color-faint)">{t('every', { d: v.every })}</span>
        <span className="flex items-baseline gap-2">
          <span className={LABEL}>{t('lastRun')}</span>
          <span data-testid="periodic-last-run" data-at={v.lastAt} className="mono text-[11px] text-(--color-ink)">
            {v.lastRun}
          </span>
        </span>
        <span className="flex items-baseline gap-2">
          <span className={LABEL}>{t('nextRun')}</span>
          <span data-testid="periodic-next-run" className="mono text-[11px] text-(--color-ink)">{v.nextRun}</span>
        </span>
        <button type="button" data-testid="periodic-run-now" onClick={runNow} className="sm-btn sm-btn-outline sm-btn-sm ml-auto">
          {t('runNow')}
        </button>
      </div>
      <Result v={v} />
      <div className={`${LABEL} mt-3`}>{t('history')}</div>
      <ol data-testid="periodic-history" className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {v.recent.map((r) => (
          <li key={r.iso} className="mono text-[11px] text-(--color-muted)">
            <time dateTime={r.iso}>{r.text}</time>
          </li>
        ))}
      </ol>
    </li>
  );
}

function Result({ v }: { v: PeriodicView }) {
  return (
    <p className={v.failed ? 'mono text-[11px] mt-2 break-all text-(--color-accent)' : 'mono text-[11px] mt-2 break-all text-(--color-muted)'}>
      {v.result}
    </p>
  );
}
