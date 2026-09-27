// TasksJobs —— the job list (filtered by kind + state) and the one open job's detail. Selecting a
// kind re-reads the overview too (tasksFilterStore), so the counts above describe these rows.

'use client';

import { useCallback, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import { SelectField } from '@/components/atoms/SelectField';
import {
  tasksDetailStore, tasksFilterStore, jobDetailView, jobRowView, kindOptions, JOB_STATES,
  type Job, type JobRowView,
} from '@/lib/admin/use-tasks';
import type { ResourceStatus } from '@/lib/state/status';
import { useAction } from '@/lib/ui/use-action';

const LABEL = 'mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-muted)';

export function TasksJobs({ jobs, kinds }: {
  jobs: { status: ResourceStatus; data: Job[] }; kinds: string[];
}) {
  const t = useTranslations('adminShell.tasks');
  return (
    <div className="mb-9">
      <AdminSectionHead className="mb-3">{t('jobsHeading')}</AdminSectionHead>
      <Filters kinds={kinds} />
      <ListPane
        status={jobs.status}
        count={jobs.data.length}
        empty={<p className="text-(--color-muted) text-[15px] reading-tight">{t('jobsEmpty')}</p>}
      >
        <ul className="border border-(--color-rule) rounded-[3px] divide-y divide-(--color-rule)">
          {jobs.data.map((j) => <JobRow key={j.id} row={jobRowView(j)} />)}
        </ul>
      </ListPane>
      <JobDetail />
    </div>
  );
}

function Filters({ kinds }: { kinds: string[] }) {
  const t = useTranslations('adminShell.tasks');
  const kind = tasksFilterStore((s) => s.kind);
  const state = tasksFilterStore((s) => s.state);
  const setKind = tasksFilterStore((s) => s.setKind);
  const setState = tasksFilterStore((s) => s.setState);
  return (
    <div className="flex flex-wrap items-end gap-4 mb-4">
      <label className="flex flex-col gap-1 min-w-[12em]">
        <span className={LABEL}>{t('filterKind')}</span>
        <SelectField testid="tasks-filter-kind" mono value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t('all')}</option>
          {kindOptions(kinds, kind).map((k) => <option key={k} value={k}>{k}</option>)}
        </SelectField>
      </label>
      <label className="flex flex-col gap-1 min-w-[12em]">
        <span className={LABEL}>{t('filterState')}</span>
        <SelectField testid="tasks-filter-state" mono value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">{t('all')}</option>
          {JOB_STATES.map((s) => <option key={s} value={s}>{t(`states.${s}`)}</option>)}
        </SelectField>
      </label>
    </div>
  );
}

function JobRow({ row }: { row: JobRowView }) {
  const run = useAction();
  const open = useCallback(() => run(() => tasksDetailStore.getState().openJob(row.id)), [run, row.id]);
  return (
    <li>
      <button
        type="button" onClick={open}
        data-testid="tasks-row" data-kind={row.kind} data-state={row.state} data-job-id={row.id}
        className="w-full flex items-baseline gap-4 px-3 py-2 text-left hover:bg-(--color-surface)"
      >
        <span className="mono text-[11px] text-(--color-faint) w-[5em]">#{row.id}</span>
        <span className="mono text-[11px] text-(--color-ink) flex-1 min-w-0 truncate">{row.kind}</span>
        <span className="mono text-[11px] text-(--color-accent)">{row.state}</span>
        <span className="mono text-[11px] text-(--color-muted)">{row.attempts}</span>
        <span className="mono text-[11px] text-(--color-muted) w-[7em] text-right">{row.created}</span>
      </button>
    </li>
  );
}

function JobDetail() {
  const job = tasksDetailStore((s) => s.job);
  return job === null ? null : <JobDetailCard job={job} />;
}

function JobDetailCard({ job }: { job: Job }) {
  const t = useTranslations('adminShell.tasks');
  const run = useAction();
  const v = jobDetailView(job);
  const act = useCallback(
    (verb: 'retry' | 'cancel') => run(() => tasksDetailStore.getState().act(verb)),
    [run],
  );
  return (
    <div data-testid="task-detail" data-job-id={job.id} className="border border-(--color-rule) rounded-[3px] p-4 mt-4 bg-(--color-surface)/50">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-3">
        <span className="mono text-[12px] text-(--color-ink)">#{job.id} · {job.kind}</span>
        <Field label={t('detailState')}><span data-testid="task-state">{v.state}</span></Field>
        <Field label={t('detailAttempts')}>{v.attempts}</Field>
        <Field label={t('detailNextRun')}><span data-testid="task-next-retry">{v.nextRun}</span></Field>
        <span className="ml-auto flex gap-3">
          <button type="button" data-testid="task-retry" onClick={() => act('retry')} className="sm-btn sm-btn-outline sm-btn-sm">
            {t('retry')}
          </button>
          <button type="button" data-testid="task-cancel" onClick={() => act('cancel')} className="sm-btn sm-btn-ghost sm-btn-sm">
            {t('cancel')}
          </button>
        </span>
      </div>
      <div className={LABEL}>{t('detailArgs')}</div>
      <pre className="mono text-[11px] text-(--color-ink) whitespace-pre-wrap break-all my-2">{v.args}</pre>
      <div className={LABEL}>{t('detailErrors')}</div>
      <ol className="mt-2 flex flex-col gap-2">
        {v.errors.map((e) => (
          <li key={e.key} data-testid="task-attempt-error" className="text-[12.5px] reading-tight">
            <span className="mono text-[10.5px] text-(--color-faint) mr-2">{t('attemptN', { n: e.attempt })} · {e.at}</span>
            <span className="mono text-[11px] text-(--color-accent) break-all">{e.error}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={LABEL}>{label}</span>
      <span className="mono text-[12px] text-(--color-ink)">{children}</span>
    </span>
  );
}
