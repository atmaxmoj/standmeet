// TasksEvents —— the event stream, newest first. Clicking an event opens which subscribers it
// fanned out to, each with its job's state.

'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import {
  tasksDetailStore, eventRowView, type EventDetail, type EventRowView, type TaskEvent,
} from '@/lib/admin/use-tasks';
import type { ResourceStatus } from '@/lib/state/status';
import { useAction } from '@/lib/ui/use-action';

const LABEL = 'mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-muted)';

export function TasksEvents({ events }: { events: { status: ResourceStatus; data: TaskEvent[] } }) {
  const t = useTranslations('adminShell.tasks');
  return (
    <div className="mb-9">
      <AdminSectionHead className="mb-3">{t('eventsHeading')}</AdminSectionHead>
      <ListPane
        status={events.status}
        count={events.data.length}
        empty={<p className="text-(--color-muted) text-[15px] reading-tight">{t('eventsEmpty')}</p>}
      >
        <ul className="border border-(--color-rule) rounded-[3px] divide-y divide-(--color-rule)">
          {events.data.map((e) => <EventRow key={String(e.id)} row={eventRowView(e)} />)}
        </ul>
      </ListPane>
      <EventDetailPane />
    </div>
  );
}

function EventRow({ row }: { row: EventRowView }) {
  const t = useTranslations('adminShell.tasks');
  const run = useAction();
  const open = useCallback(() => run(() => tasksDetailStore.getState().openEvent(row.id)), [run, row.id]);
  return (
    <li>
      <button
        type="button" onClick={open}
        data-testid="event-row" data-type={row.type} data-subject={row.subject} data-event-id={row.id}
        className="w-full flex items-baseline gap-4 px-3 py-2 text-left hover:bg-(--color-surface)"
      >
        <span className="mono text-[11px] text-(--color-accent)">{row.type}</span>
        <span className="mono text-[11px] text-(--color-ink) flex-1 min-w-0 truncate">{row.subject}</span>
        <span className="mono text-[11px] text-(--color-muted)">{t(`eventStatus.${row.status}`)}</span>
        <span className="mono text-[11px] text-(--color-muted) w-[7em] text-right">{row.when}</span>
      </button>
    </li>
  );
}

function EventDetailPane() {
  const detail = tasksDetailStore((s) => s.event);
  return detail === null ? null : <EventDetailCard detail={detail} />;
}

// RequeueButton —— only a poisoned event (one the relay gave up on) can be put back in line.
function RequeueButton({ poisoned }: { poisoned: boolean }) {
  const t = useTranslations('adminShell.tasks');
  const run = useAction();
  const requeue = useCallback(() => run(() => tasksDetailStore.getState().requeueEvent()), [run]);
  return !poisoned ? null : (
    <button
      type="button" onClick={requeue} data-testid="event-requeue"
      className="mono text-[11px] uppercase tracking-[0.12em] text-(--color-accent) hover:underline my-2"
    >
      {t('requeue')}
    </button>
  );
}

function EventDetailCard({ detail }: { detail: EventDetail }) {
  const t = useTranslations('adminShell.tasks');
  return (
    <div data-testid="event-detail" className="border border-(--color-rule) rounded-[3px] p-4 mt-4 bg-(--color-surface)/50">
      <div className="mono text-[12px] text-(--color-ink) mb-2">
        {detail.event.type} · {detail.event.subject}
      </div>
      <p className="mono text-[11px] text-(--color-accent) break-all">{detail.event.last_error ?? ''}</p>
      <RequeueButton poisoned={detail.event.poisoned === true} />
      <pre className="mono text-[11px] text-(--color-ink) whitespace-pre-wrap break-all my-2">
        {JSON.stringify(detail.event.data ?? {}, null, 2)}
      </pre>
      <div className={LABEL}>{t('fanoutHeading')}</div>
      <ul className="mt-2 flex flex-col gap-1">
        {detail.fanout.map((f) => (
          <li
            key={`${f.subscriber}-${f.job_id}`}
            data-testid="event-fanout" data-subscriber={f.subscriber} data-state={f.state}
            className="flex items-baseline gap-4 mono text-[11px]"
          >
            <span className="text-(--color-ink)">{f.subscriber}</span>
            <span className="text-(--color-faint)">#{f.job_id}</span>
            <span className="text-(--color-accent)">{f.state}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
