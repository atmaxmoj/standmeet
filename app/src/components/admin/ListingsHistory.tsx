// ListingsHistory —— /admin/listings' history view (job-loop roadmap 8.3.b): every posting the
// boards or Job Scout showed, under the day it was first seen; opening one shows what the owner's AI
// noted on it (reason, deductions, interview reports).

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { LoadMore } from '@/components/admin/LoadMore';
import {
  assessmentLines, useJobHistory, type DayGroup, type SeenRow,
} from '@/lib/admin/use-job-history';

export function ListingsHistory() {
  const t = useTranslations('adminJobs');
  const hook = useJobHistory();
  return (
    <div data-testid="listings-history">
      {hook.days.map((g) => <Day key={g.day} group={g} />)}
      <p className="mono text-[11px] text-(--color-muted)">
        {hook.days.length === 0 && !hook.loading ? t('listings.historyEmpty') : ''}
      </p>
      <LoadMore page={hook.page} testid="listings-history-more" />
    </div>
  );
}

function Day({ group }: { group: DayGroup }) {
  return (
    <section className="mb-5" data-testid={`listings-history-day-${group.day}`}>
      <div className="sm-smallcaps mb-1.5">{group.day}</div>
      <ul className="space-y-1.5">
        {group.rows.map((r) => <Row key={r.id} row={r} />)}
      </ul>
    </section>
  );
}

function Row({ row }: { row: SeenRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="list-none border border-(--color-rule) rounded-[3px]">
      <button
        type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        data-testid={`history-row-${row.id}`}
        className="w-full text-left px-3 py-2 flex items-baseline justify-between gap-3"
      >
        <span>
          <span className="font-serif text-[15px] text-(--color-ink)">{row.title}</span>
          <span className="font-serif italic text-[14px] text-(--color-muted) ml-2">· {row.company}</span>
        </span>
        <span className="mono text-[10px] uppercase tracking-[0.12em] text-(--color-muted)">
          {row.status}{row.score === undefined ? '' : ` · ${row.score}`}
        </span>
      </button>
      {open && <Detail row={row} />}
    </li>
  );
}

function Detail({ row }: { row: SeenRow }) {
  const t = useTranslations('adminJobs');
  const lines = assessmentLines(row);
  return (
    <div className="px-3 pb-3 border-t border-(--color-rule)/60" data-testid={`history-detail-${row.id}`}>
      <a href={row.url} target="_blank" rel="noreferrer" className="mono text-[11px] text-(--color-accent) break-all">
        {row.url}
      </a>
      <ul className="mt-1.5 space-y-0.5">
        {lines.map((l) => <li key={l} className="reading text-[13px] text-(--color-ink)">{l}</li>)}
      </ul>
      <p className="mono text-[10px] text-(--color-faint) mt-1">
        {lines.length === 0 ? t('listings.historyNoNotes') : ''}
      </p>
    </div>
  );
}
