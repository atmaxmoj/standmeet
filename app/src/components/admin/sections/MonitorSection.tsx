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
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListPane } from '@/components/admin/ListPane';
import { Toggle } from '@/components/atoms/Toggle';
import {
  useMonitor, MONITOR_WINDOWS, toSessionCells, paginate,
  type FeedView, type MonitorRow, type MonitorSession, type SessionCells,
  type MonitorSummary, type MonitorWindow, type Paged,
} from '@/lib/admin/use-monitor';
import { useMonitoringSwitch } from '@/lib/admin/use-monitoring';
import type { ResourceStatus } from '@/lib/state/status';
import { useEffectErrorToast } from '@/lib/ui/toast';

// MonitorTab —— which single view is on screen. The sessions table and the event feed used to
// stack on one long page; now a tab row (below the window picker) shows exactly one at a time.
type MonitorTab = 'feed' | 'sessions';

export function MonitorSection() {
  const t = useTranslations('adminShell.monitor');
  const hook = useMonitor();
  useEffectErrorToast(hook.error);
  const [tab, setTab] = useState<MonitorTab>('feed');
  // A page index per view, kept as the owner switches tabs. paginate() clamps a stale index, so a
  // window change that shrinks a list can never strand the viewer on a now-empty page.
  const [feedPage, setFeedPage] = useState(0);
  const [sessionsPage, setSessionsPage] = useState(0);
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
      <CollectionSwitch />
      <WindowPicker current={hook.window} onPick={hook.setWindow} />
      <Summary summary={hook.summary} />
      <TabBar tab={tab} onPick={setTab} />
      {tab === 'feed'
        ? <FeedPanel rows={hook.rows} view={hook.view} page={feedPage} onPage={setFeedPage} />
        : (
          <SessionsPanel
            status={hook.status} sessions={hook.sessions}
            page={sessionsPage} onPage={setSessionsPage}
          />
        )}
    </>
  );
}

// CollectionSwitch —— the owner's traffic-collection master switch (monitor.md §8). Off collects
// nothing new; the numbers below then only ever reflect what was recorded while it was on. It sits
// above the window picker because it governs whether there is anything to show at all.
function CollectionSwitch() {
  const t = useTranslations('adminShell.monitor');
  const s = useMonitoringSwitch();
  return (
    <div
      data-testid="monitor-collection"
      className="flex items-center gap-3 mb-6 pb-5 border-b border-(--color-rule)"
    >
      <Toggle
        on={s.enabled}
        onToggle={s.toggle}
        disabled={s.loading || s.saving}
        label={t('collection')}
        testid="monitor-collection-toggle"
      />
      <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted)">
        {t('collection')}
      </span>
      <span data-testid="monitor-collection-state" className="text-[12.5px] text-(--color-faint) reading-tight">
        {s.enabled ? t('collectionOn') : t('collectionOff')}
      </span>
    </div>
  );
}

// TabBar —— the second row of tabs (under the window picker) that picks feed vs sessions. Both are
// counted over the same window; the window picker above still governs both.
function TabBar({ tab, onPick }: { tab: MonitorTab; onPick: (t: MonitorTab) => void }) {
  const t = useTranslations('adminShell.monitor');
  return (
    <div data-testid="monitor-tabs" className="flex items-baseline gap-4 mb-6">
      <TabButton tab="feed" active={tab === 'feed'} onPick={onPick} label={t('feed')} />
      <TabButton tab="sessions" active={tab === 'sessions'} onPick={onPick} label={t('sessionsHeading')} />
    </div>
  );
}

function TabButton({ tab, active, onPick, label }: {
  tab: MonitorTab; active: boolean; onPick: (t: MonitorTab) => void; label: string;
}) {
  return (
    <button
      type="button"
      data-testid={`monitor-tab-${tab}`}
      aria-pressed={active}
      onClick={() => onPick(tab)}
      className={`mono text-[11px] tracking-[0.14em] uppercase ${
        active
          ? 'text-(--color-accent) border-b border-(--color-accent)'
          : 'text-(--color-muted) hover:text-(--color-ink)'
      }`}
    >
      {label}
    </button>
  );
}

// FeedPanel —— the event feed, one page at a time. loading / empty keep their own renderings (a
// heading over nothing reads as "no visitors"); the rows case pages the list.
function FeedPanel(
  { rows, view, page, onPage }: {
    rows: readonly MonitorRow[]; view: FeedView; page: number; onPage: (p: number) => void;
  },
) {
  const t = useTranslations('adminShell.monitor');
  const paged = paginate(rows, page);
  return {
    loading: <p data-testid="monitor-loading" className="text-(--color-muted) text-[15px]">
      {t('loading')}
    </p>,
    empty: <p data-testid="monitor-empty" className="text-(--color-muted) text-[15px] reading-tight">
      {t('empty')}
    </p>,
    rows: <>
      <FeedTable rows={paged.items} />
      <Pager which="feed" paged={paged} onPage={onPage} />
    </>,
  }[view];
}

// SessionsPanel —— the per-viewer table, one page at a time. Empty is the fresh-instance normal,
// rendered as a note rather than a bare heading.
function SessionsPanel(
  { status, sessions, page, onPage }: {
    status: ResourceStatus; sessions: readonly MonitorSession[];
    page: number; onPage: (p: number) => void;
  },
) {
  const t = useTranslations('adminShell.monitor');
  const paged = paginate(sessions, page);
  // ListPane, not `sessions.length === 0`: a failed load is also an empty array, and it must not
  // wear the empty state's clothes (error/loading are checked before the count).
  return (
    <ListPane
      status={status}
      count={sessions.length}
      empty={(
        <p data-testid="monitor-sessions-empty" className="text-(--color-muted) text-[15px] reading-tight">
          {t('empty')}
        </p>
      )}
    >
      <SessionsTable sessions={paged.items} />
      <Pager which="sessions" paged={paged} onPage={onPage} />
    </ListPane>
  );
}

// Pager —— prev / page-of-pages / next. Hidden entirely when there is only one page (nothing to
// page). Arrow glyphs + aria-label (attributes are i18n-exempt); the indicator is numbers only, so
// the control needs no translatable text.
function Pager<T>(
  { which, paged, onPage }: { which: string; paged: Paged<T>; onPage: (p: number) => void },
) {
  const t = useTranslations('adminShell.monitor');
  return paged.pages <= 1 ? null : (
    <div data-testid={`monitor-${which}-pager`} className="flex items-center gap-4 mt-4">
      <button
        type="button" data-testid={`monitor-${which}-prev`} aria-label={t('prevPage')}
        disabled={!paged.hasPrev} onClick={() => onPage(paged.page - 1)}
        className="mono text-[13px] text-(--color-muted) hover:text-(--color-ink) disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ‹
      </button>
      <span data-testid={`monitor-${which}-page`} className="mono text-[10.5px] tracking-[0.14em] text-(--color-faint)">
        {paged.page + 1} / {paged.pages}
      </span>
      <button
        type="button" data-testid={`monitor-${which}-next`} aria-label={t('nextPage')}
        disabled={!paged.hasNext} onClick={() => onPage(paged.page + 1)}
        className="mono text-[13px] text-(--color-muted) hover:text-(--color-ink) disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ›
      </button>
    </div>
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
function SessionsTable({ sessions }: { sessions: readonly MonitorSession[] }) {
  const t = useTranslations('adminShell.monitor');
  return (
    <div data-testid="monitor-sessions" className="mb-6">
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
    <tr
      data-testid="monitor-row" data-row-id={row.id}
      className="border-b border-(--color-rule) align-baseline"
    >
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
