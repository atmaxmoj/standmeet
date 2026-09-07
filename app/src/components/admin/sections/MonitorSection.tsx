// MonitorSection —— /admin/monitor. Who came, where from, and what they read
// (docs/design/monitor.md §10).
//
// Two panels, in the order an owner reads them: five numbers, then the events those numbers are
// made of. The feed is there because a summary cannot be checked against itself — seeing "12
// views" is only useful if you can also see which twelve.
//
// Bots are counted apart and never mixed into the four human numbers. A crawler visit is real
// information (a link pasted into a group chat, an AI reading the corpus), but it is not a
// reader, and adding it to "viewers" would make every other number a lie.

'use client';

import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import {
  useMonitor, type FeedView, type MonitorRow, type MonitorSummary,
} from '@/lib/admin/use-monitor';
import { useEffectErrorToast } from '@/lib/ui/toast';

export function MonitorSection() {
  const t = useTranslations('adminShell.monitor');
  const hook = useMonitor();
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader
        kicker={t('kicker')}
        slug="monitor"
        count={hook.status === 'ready' ? `${hook.summary.views}` : ''}
      />
      <p className="reading-tight text-(--color-muted) mb-7 text-[15px] max-w-[54em]">
        {t('intro')}
      </p>
      <Summary summary={hook.summary} />
      <Feed rows={hook.rows} view={hook.view} />
    </>
  );
}

function Summary({ summary }: { summary: MonitorSummary }) {
  const t = useTranslations('adminShell.monitor');
  return (
    <div
      data-testid="monitor-summary"
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-(--color-rule) mb-9"
    >
      <Stat testid="stat-viewers" label={t('viewers')} value={summary.viewers} hint={t('viewersHint')} />
      <Stat testid="stat-visits" label={t('visits')} value={summary.visits} hint={t('visitsHint')} />
      <Stat testid="stat-views" label={t('views')} value={summary.views} hint={t('viewsHint')} />
      <Stat testid="stat-events" label={t('events')} value={summary.events} hint={t('eventsHint')} />
      <Stat testid="stat-bots" label={t('bots')} value={summary.bots} hint={t('botsHint')} muted />
    </div>
  );
}

function Stat(props: {
  testid: string; label: string; value: number; hint: string; muted?: boolean;
}) {
  return (
    <div className="bg-(--color-paper) px-4 py-4" data-testid={props.testid}>
      <div className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-muted)">
        {props.label}
      </div>
      <div
        data-testid={`${props.testid}-value`}
        className={`font-serif text-[30px] leading-none mt-2 ${
          props.muted ? 'text-(--color-muted)' : 'text-(--color-ink)'
        }`}
      >
        {props.value}
      </div>
      <div className="text-[12px] text-(--color-muted) mt-2 reading-tight">{props.hint}</div>
    </div>
  );
}

function Feed({ rows, view }: { rows: readonly MonitorRow[]; view: FeedView }) {
  const t = useTranslations('adminShell.monitor');
  // Three states, three renderings. "Still loading" must never borrow the empty state's words,
  // and neither may render the feed's heading over nothing — a heading with no rows under it
  // says "you have no visitors" whether or not that is true yet.
  return {
    loading: <p data-testid="monitor-loading" className="text-(--color-muted) text-[15px]">
      {t('loading')}
    </p>,
    // Nothing yet is the normal state of a fresh instance, and it must not read as a fault.
    empty: <p data-testid="monitor-empty" className="text-(--color-muted) text-[15px] reading-tight">
      {t('empty')}
    </p>,
    rows: <FeedTable rows={rows} />,
  }[view];
}

function FeedTable({ rows }: { rows: readonly MonitorRow[] }) {
  const t = useTranslations('adminShell.monitor');
  return (
    <div data-testid="monitor-feed">
      <h3 className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-muted) mb-3">
        {t('feed')}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <tbody>
            {rows.map((r) => <Row key={r.id} row={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row }: { row: MonitorRow }) {
  return (
    <tr data-testid="monitor-row" className="border-b border-(--color-rule) align-baseline">
      <td className="mono text-[11px] text-(--color-muted) py-2 pr-4 whitespace-nowrap">
        {row.time}
      </td>
      <td className="mono text-[11px] py-2 pr-4 whitespace-nowrap text-(--color-accent)">
        {row.surface}
      </td>
      <td className="py-2 pr-4">
        <span data-testid="monitor-row-what" className="text-(--color-ink)">{row.what}</span>
      </td>
      <td className="mono text-[11px] text-(--color-muted) py-2 pr-4 whitespace-nowrap">
        {row.from}
      </td>
      <td className="mono text-[11px] text-(--color-muted) py-2 whitespace-nowrap">
        {row.who}
      </td>
    </tr>
  );
}
