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

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import {
  useMonitor, MONITOR_WINDOWS, toSessionCells,
  type FeedView, type MonitorRow, type MonitorSession, type SessionCells,
  type MonitorSummary, type MonitorWindow,
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
      <WindowPicker current={hook.window} onPick={hook.setWindow} />
      <Summary summary={hook.summary} />
      <Sessions sessions={hook.sessions} />
      <Feed rows={hook.rows} view={hook.view} />
    </>
  );
}

// WindowPicker —— the span every number below is counted over.
//
// Above the numbers, not beside the feed: it governs both panels, and a control that sits next to
// one of the two things it changes reads as belonging to that one.
function WindowPicker(
  { current, onPick }: { current: MonitorWindow; onPick: (w: MonitorWindow) => void },
) {
  const t = useTranslations('adminShell.monitor');
  return (
    <div data-testid="monitor-window" className="flex items-baseline gap-4 mb-5">
      <span className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-faint)">
        {t('window')}
      </span>
      {MONITOR_WINDOWS.map((w) => (
        <WindowButton key={w} window={w} active={w === current} onPick={onPick} />
      ))}
    </div>
  );
}

function WindowButton({ window, active, onPick }: {
  window: MonitorWindow; active: boolean; onPick: (w: MonitorWindow) => void;
}) {
  const t = useTranslations('adminShell.monitor');
  return (
    <button
      type="button"
      data-testid={`monitor-window-${window}`}
      // aria-pressed, not only a colour. Which span is showing is the difference between two
      // readings of the same panel, and a reader who cannot see the colour has no other cue.
      aria-pressed={active}
      onClick={() => onPick(window)}
      className={`mono text-[11px] tracking-[0.14em] uppercase ${
        active
          ? 'text-(--color-accent) border-b border-(--color-accent)'
          : 'text-(--color-muted) hover:text-(--color-ink)'
      }`}
    >
      {t(`windows.${window}`)}
    </button>
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

// Sessions —— the per-viewer breakdown, the summary's numbers made legible as PEOPLE. Each row is
// one viewer (a monthly-salted hash, never an identity): its visits + views, where it came from,
// on what browser/os/device, and when last seen. Bots are flagged in place, not hidden.
function Sessions({ sessions }: { sessions: readonly MonitorSession[] }) {
  const t = useTranslations('adminShell.monitor');
  return sessions.length === 0 ? null : (
    <div data-testid="monitor-sessions" className="mb-9">
      <h3 className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-muted) mb-3">
        {t('sessionsHeading')}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint) text-left">
              <Th>{t('colSession')}</Th><Th>{t('visits')}</Th><Th>{t('views')}</Th>
              <Th>{t('colCountry')}</Th><Th>{t('colCity')}</Th><Th>{t('colBrowser')}</Th>
              <Th>{t('colOs')}</Th><Th>{t('colDevice')}</Th><Th>{t('colLastSeen')}</Th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => <SessionRow key={s.viewer_id} cells={toSessionCells(s)} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="py-2 pr-4 font-normal whitespace-nowrap">{children}</th>;
}

// SessionRow —— all display + fallback decisions were made in toSessionCells, so this only places
// strings into testid'd cells (the presentation layer holds no branches).
function SessionRow({ cells }: { cells: SessionCells }) {
  return (
    <tr data-testid="monitor-session-row" className="border-b border-(--color-rule) align-baseline">
      <Cell testid="monitor-session-id" mono>{cells.id}</Cell>
      <Cell testid="monitor-session-visits" mono>{cells.visits}</Cell>
      <Cell testid="monitor-session-views" mono>{cells.views}</Cell>
      <Cell testid="monitor-session-country">{cells.country}</Cell>
      <Cell testid="monitor-session-city">{cells.city}</Cell>
      <Cell testid="monitor-session-browser">{cells.browser}</Cell>
      <Cell testid="monitor-session-os">{cells.os}</Cell>
      <Cell testid="monitor-session-device">{cells.device}</Cell>
      <Cell testid="monitor-session-lastseen" mono>{cells.lastSeen}</Cell>
    </tr>
  );
}

function Cell(
  { testid, children, mono }: { testid: string; children: ReactNode; mono?: boolean },
) {
  return (
    <td
      data-testid={testid}
      className={`py-2 pr-4 whitespace-nowrap text-(--color-ink) ${mono ? 'mono text-[11px]' : 'text-[12.5px]'}`}
    >
      {children}
    </td>
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
