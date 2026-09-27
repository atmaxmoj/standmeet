// TasksSection —— /admin/tasks. The background-work panel: what the job queue holds, which jobs
// failed and why, what the periodic schedule last did, and which events fanned out where
// (docs/design/event-bus-outbox-webhooks.md, *Admin "Tasks" panel*).
//
// One page, read top to bottom: alerts, counts, the job list (+ one job's detail), the periodic
// schedule, the event stream. Every display decision is made in use-tasks; this file places strings.

'use client';

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { TasksEvents } from '@/components/admin/sections/tasks/TasksEvents';
import { TasksJobs } from '@/components/admin/sections/tasks/TasksJobs';
import { TasksPeriodic } from '@/components/admin/sections/tasks/TasksPeriodic';
import {
  useTasks, activeAlerts, openJobParam, countText, durationText, JOB_STATES,
  type JobState, type TasksOverview,
} from '@/lib/admin/use-tasks';
import { useEffectErrorToast } from '@/lib/ui/toast';

export function TasksSection() {
  const t = useTranslations('adminShell.tasks');
  const hook = useTasks(openJobParam(useSearchParams().get('job')));
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader kicker={t('kicker')} slug="tasks" />
      <p className="reading-tight text-(--color-muted) mb-7 text-[15px] max-w-[54em]">
        {t('intro')}
      </p>
      {hook.overview && <Overview overview={hook.overview} />}
      <TasksJobs jobs={hook.jobs} kinds={hook.kinds} />
      <TasksPeriodic periodic={hook.periodic} />
      <TasksEvents events={hook.events} />
    </>
  );
}

// Overview —— rendered only once loaded (the hook gives null before that).
function Overview({ overview }: { overview: TasksOverview }) {
  const t = useTranslations('adminShell.tasks');
  return (
    <div data-testid="tasks-overview" className="mb-9">
      {activeAlerts(overview.alerts).map((code) => (
        <p
          key={code} data-testid="tasks-alert" data-alert={code}
          className="reading-tight italic text-(--color-accent) text-[14px] mb-2"
        >
          {t(`alerts.${code}`)}
        </p>
      ))}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-px bg-(--color-rule) mt-3">
        {JOB_STATES.map((s) => <Count key={s} state={s} value={countText(overview, s)} />)}
        <Stat label={t('oldestPending')} testid="tasks-oldest-pending">
          {durationText(overview.jobs.oldest_pending_age_ns)}
        </Stat>
      </div>
    </div>
  );
}

function Count({ state, value }: { state: JobState; value: string }) {
  const t = useTranslations('adminShell.tasks');
  return <Stat label={t(`states.${state}`)} testid={`tasks-count-${state}`}>{value}</Stat>;
}

function Stat({ label, testid, children }: { label: string; testid: string; children: string }) {
  return (
    <div className="bg-(--color-paper) px-4 py-4">
      <div className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-muted)">{label}</div>
      <div data-testid={testid} className="font-serif text-[30px] leading-none mt-2 text-(--color-ink)">
        {children}
      </div>
    </div>
  );
}
