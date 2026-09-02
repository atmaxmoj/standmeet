// DashboardSection —— /admin/dashboard. Design source: admin.js DashboardSection
// (199-311): row 1 = 4 KPI stats; row 2 = corpus pulse sparkline (14d) +
// jobs heat card; row 3 = recent visitors table + needs-your-hand action list.

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import Link from 'next/link';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { fetchItemCount, type DashboardRecentRow } from '@/lib/admin/dashboard-fetch';
import { useRecentConversations } from '@/lib/admin/use-recent-conversations';
import { Sparkline } from '@/components/admin/atoms/Sparkline';
import {
  jobHeadline,
  jobHint,
  poolCountLabel,
  poolHeadState,
  type JobsLoopInput,
  type PoolHeadState,
} from '@/lib/admin/jobs-loop-view';
import { useAdminListings } from '@/lib/admin/use-admin-listings';
import { useAdminSources } from '@/lib/admin/use-admin-sources';
import { ago, stampMinute } from '@/lib/ui/format-time';
import {
  useAdminDashboard,
  type ActionItem,
  type DashboardStats,
} from '@/lib/admin/use-admin-dashboard';
import {
  kpiCards, needsItems, pulseView, type KpiCard, type PulseView,
} from '@/lib/admin/dashboard-view';

export function DashboardSection() {
  const { stats, loading, error } = useAdminDashboard();
  return (
    <div data-testid="dashboard">
      <SectionHeader
        kicker="overview"
        slug="dashboard"
        count={loading ? 'loading…' : 'last refresh · now'}
      />
      <KpiRow stats={stats} />
      <MiddleRow stats={stats} />
      <BottomRow stats={stats} />
      <ErrorBlock msg={error} />
    </div>
  );
}

// KpiRow —— the value and the small line below it are both computed in one place,
// `kpiCards` (F-L-52). This layer only renders: when there's no data, that small
// line **simply doesn't exist**, so there's no need to check for it again here.
function KpiRow({ stats }: { stats: DashboardStats | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" data-testid="dashboard-kpis">
      {kpiCards(stats).map((c) => <Kpi key={c.key} card={c} />)}
    </div>
  );
}

function Kpi({ card }: { card: KpiCard }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid={`kpi-${card.label}`}>
      <div className="sm-smallcaps mb-1.5">{card.label}</div>
      <div className="font-serif text-(--color-ink) text-[34px] tabular-nums leading-none tracking-[-0.02em]">
        {card.value}
      </div>
      <KpiTrend trend={card.trend} sub={card.sub} />
    </div>
  );
}

function KpiTrend({ trend, sub }: { trend?: string; sub?: string }) {
  const hasTrend = (trend ?? sub) !== undefined;
  return hasTrend ? <KpiTrendBody trend={trend} sub={sub} /> : null;
}

function kpiTrendTone(trend?: string): string {
  return trend?.startsWith('↑') ? 'text-(--color-accent)' : 'text-(--color-muted)';
}

function KpiTrendBody({ trend, sub }: { trend?: string; sub?: string }) {
  return (
    <div className={`mono text-[10px] tracking-[0.06em] mt-1.5 ${kpiTrendTone(trend)}`}>
      {trend}<KpiTrendSub sub={sub} />
    </div>
  );
}

function KpiTrendSub({ sub }: { sub?: string }) {
  return sub ? <span className="text-(--color-faint)"> · {sub}</span> : null;
}

function MiddleRow({ stats }: { stats: DashboardStats | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 mb-6">
      <CorpusPulse stats={stats} />
      <JobsHeat />
    </div>
  );
}

function CorpusPulse({ stats }: { stats: DashboardStats | null }) {
  const t = useTranslations('adminShell.dashboard');
  const v = pulseView(stats);
  return (
    <div
      className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50"
      data-testid="dash-corpus-pulse"
    >
      <GroupHeader title="corpus pulse · 14d" action={<PulseVerdict verdict={v.verdict} />} />
      <div className="flex items-end gap-6 mt-2">
        <div>
          <div className="font-serif text-(--color-ink) text-[34px] tabular-nums leading-none">
            {v.total}
          </div>
          <div className="mono text-[10px] text-(--color-muted) tracking-[0.06em] mt-1">
            {t('entriesTotal')}
          </div>
        </div>
        <div className="flex-1">
          <CorpusSparkline pulse={v.series} days={v.days} />
          <div className="mono text-[9.5px] text-(--color-faint) tracking-[0.06em] mt-1 flex justify-between">
            <span>{t('daysAgo14')}</span><span>{t('today')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// PulseVerdict —— the top-right line **reads the line right next to it**. It used to
// be an unconditional `↑ corpus active` in vermillion regardless of the 14-day count,
// even at zero (UX-41: asserting something it never tracked, [[names-that-lie]]). An
// always-true verdict is decoration, not a conclusion. verdict === undefined means the
// series hasn't arrived, and no conclusion may be stated then — `nothing new in 14d`
// is a claim, and it knows nothing at that moment (F-L-52). Empty check is in `pulseView`.
function PulseVerdict({ verdict }: { verdict: PulseView['verdict'] }) {
  return verdict === undefined ? null : (
    <VerdictText active={verdict.active} added={verdict.added} />
  );
}

function VerdictText({ active, added }: { active: boolean; added: number }) {
  const t = useTranslations('adminShell.dashboard');
  return active ? (
    <span className="mono text-[10px] text-(--color-accent)" data-testid="pulse-verdict">
      {t('corpusActive', { added })}
    </span>
  ) : (
    <span className="mono text-[10px] text-(--color-faint)" data-testid="pulse-verdict">
      {t('corpusQuiet')}
    </span>
  );
}

// CorpusSparkline —— draws the **real** series (rot-A1). An empty instance → an
// empty pulse → a flat line, which is exactly the honest shape; this used to be a
// hardcoded MOCK_14D, a jagged line that never moved and had nothing to do with the
// corpus.
function CorpusSparkline({ pulse, days }: { pulse: readonly number[]; days: readonly string[] }) {
  return <Sparkline data={pulse} labels={days} width={260} height={48} label="corpus pulse · 14d" />;
}

function JobsHeat() {
  const t = useTranslations('adminShell.dashboard');
  const { sent } = useApplicationCount();
  const sources = useAdminSources();
  const listings = useAdminListings();
  const loop: JobsLoopInput = {
    sourceCount: sources.rows.length,
    listings: listings.rows,
    loading: sources.loading || listings.loading,
    error: sources.error ?? listings.error,
  };
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid="dash-jobs-panel">
      <GroupHeader title="jobs · active loop" action={
        <Link href="/admin/listings" className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)">
          {t('viewAll')}
        </Link>
      } />
      <div className="grid grid-cols-2 gap-3 mt-2">
        <div>
          {/* Vocabulary aligned with /admin/listings: that page writes "in pool" — there is no such thing as a "shortlist" in the product. */}
          <div className="sm-smallcaps mb-1">{t('inPool')}</div>
          <div
            className="font-serif text-(--color-ink) text-[34px] tabular-nums leading-none"
            data-testid="dash-pool-count"
          >
            {poolCountLabel(loop)}
          </div>
        </div>
        <div>
          <div className="sm-smallcaps mb-1">{t('applications')}</div>
          <StatCount state={sent} testid="dash-applications-sent" />
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-(--color-rule)/60">
        {/* "top match" is ranked by Claude — StandMeet can't rank it, so this reports the newest item in the pool instead. */}
        <div className="sm-smallcaps mb-1">{t('newestInPool')}</div>
        <PoolHead state={poolHeadState(loop)} />
      </div>
    </div>
  );
}

// CountState —— three states, not "a number or nothing". "Still fetching" and
// "failed to fetch" must be kept apart: collapse both into the same empty value and
// no one can tell loading from failed — not even a test (the first version of this
// spec passed for exactly this false-green reason). "0 sent" is a factual claim;
// when the GET fails, the fact isn't 0, it's unknown (the same class as F-A-13).
type CountState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ok'; n: number };

function useApplicationCount(): { sent: CountState } {
  const [sent, setSent] = useState<CountState>({ kind: 'loading' });
  useEffect(() => {
    void fetchItemCount('/api/admin/applications/')
      .then((n) => setSent({ kind: 'ok', n }))
      .catch(() => setSent({ kind: 'error' }));
  }, []);
  return { sent };
}

// StatCount —— each of the three states has its own literal: '…' still fetching,
// '—' failed to fetch, a number = a real number. '—' **only** means failure.
function StatCount({ state, testid }: { state: CountState; testid: string }) {
  return (
    <div
      className="font-serif text-(--color-ink) text-[34px] tabular-nums leading-none"
      data-testid={testid}
    >
      {state.kind === 'ok' ? state.n : state.kind === 'loading' ? '…' : '—'}
    </div>
  );
}

// PoolHead —— this line states the pool's real state right now. Each of the five
// branches says its own thing, in particular separating "no sources at all" from
// "sources exist but never fetched" — the previous version said "go register
// sources" for both of those (and the other three) alike (F-E-2).
function PoolHead({ state }: { state: PoolHeadState }) {
  const t = useTranslations('adminShell.dashboard');
  const lines = {
    loading: { head: t('poolLoading'), hint: '' },
    error: { head: t('poolError'), hint: '' },
    noSources: { head: t('registerSources'), hint: t('sourcesHint') },
    noFetch: { head: t('nothingFetched'), hint: t('nothingFetchedHint') },
    job: { head: jobHeadline(state), hint: jobHint(state) },
  } as const;
  return <PoolHeadLines line={lines[state.kind]} />;
}

function PoolHeadLines({ line }: { line: { head: string; hint: string } }) {
  return (
    <>
      <div
        className="font-serif text-[16px] text-(--color-muted) italic"
        data-testid="dash-pool-head"
      >
        {line.head}
      </div>
      <div className="mono text-[10px] text-(--color-faint) tracking-[0.06em] mt-1">
        {line.hint}
      </div>
    </>
  );
}

function BottomRow({ stats }: { stats: DashboardStats | null }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <RecentVisitors />
      <NeedsYourHand stats={stats} />
    </div>
  );
}

function RecentVisitors() {
  const t = useTranslations('adminShell.dashboard');
  const { rows } = useRecentConversations();
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <GroupHeader title="recent visitors" action={
        <Link href="/admin/conversations" className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)">
          {t('all')}
        </Link>
      } />
      <RecentVisitorsList rows={rows} />
    </div>
  );
}

function RecentVisitorsList({ rows }: { rows: readonly DashboardRecentRow[] | null | undefined }) {
  return rows === undefined
    ? <div className="mono text-[11px] text-(--color-faint) tracking-[0.06em] mt-2">—</div>
    : <RecentVisitorsLoaded rows={rows} />;
}

function RecentVisitorsLoaded({ rows }: { rows: readonly DashboardRecentRow[] | null }) {
  const t = useTranslations('adminShell.dashboard');
  return rows === null ? (
    <div
      className="mono text-[11px] text-(--color-accent) tracking-[0.06em] mt-2"
      data-testid="dash-recent-error"
    >
      {t('recentError')}
    </div>
  ) : rows.length === 0 ? (
    <div className="mono text-[11px] text-(--color-faint) tracking-[0.06em] mt-2">
      {t('noConversations')}
    </div>
  ) : (
    <div className="flex flex-col">
      {rows.map((r) => <RecentVisitorRow key={r.id} row={r} />)}
    </div>
  );
}

function RecentVisitorRow({ row }: { row: DashboardRecentRow }) {
  const t = useTranslations('adminShell.dashboard');
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-(--color-rule)/60 last:border-b-0">
      <div>
        <div className="font-serif text-[15px] text-(--color-ink)">{row.visitor}</div>
        {/* "Recent visitors" is scanned at a glance for freshness, so give relative time; the exact value goes in the title, visible on hover. This used to print the backend's `2026-08-07T01:09:14Z` directly — ISO-with-Z is meant for machines to read (UX-46). */}
        <div className="mono text-[10px] text-(--color-muted) mt-0.5" title={stampMinute(row.last)}>
          {t('visitorMeta', { label: row.code_label, turns: row.turns, last: ago(row.last) })}
        </div>
      </div>
      <RecentVisitorFlags hits={row.private_hits} />
    </div>
  );
}

function RecentVisitorFlags({ hits }: { hits: number }) {
  const t = useTranslations('adminShell.dashboard');
  return hits > 0
    ? <span className="mono text-[9.5px] tracking-[0.14em] text-(--color-accent)">{t('privHits', { n: hits })}</span>
    : null;
}

// NeedsYourHand —— the sentence on this screen most likely to be taken at face value
// lives here: say "nothing needs your attention" and the owner genuinely stops
// checking. So **this sentence must not be spoken** before `stats` has arrived
// (F-L-52: it used to write "Nothing pending — corpus is current." during the
// loading frame, at a moment when it didn't even know how many entries the corpus
// had).
function NeedsYourHand({ stats }: { stats: DashboardStats | null }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid="needs-hand">
      <GroupHeader title="needs your hand" />
      <NeedsList items={needsItems(stats)} />
    </div>
  );
}

// items being undefined means stats hasn't arrived yet. **An empty array and "still
// unknown" must be kept apart**: an empty array says "all checked, nothing's up",
// and the owner can stand down on that; undefined says "still unknown", and nothing
// is allowed to be said at that moment (F-L-52). Use the same mark as the big
// numbers, `—` — a dash asserts nothing.
function NeedsList({ items }: { items: ActionItem[] | undefined }) {
  return items === undefined
    ? <p className="mono text-[11px] text-(--color-faint) mt-2">—</p>
    : <NeedsRows items={items} />;
}

function NeedsRows({ items }: { items: ActionItem[] }) {
  return items.length === 0 ? <EmptyAction /> : (
    <ul className="flex flex-col gap-3" data-testid="dashboard-needs">
      {items.map((i) => <NeedRow key={i.key} item={i} />)}
    </ul>
  );
}

function EmptyAction() {
  const t = useTranslations('adminShell.dashboard');
  return (
    <p className="reading text-(--color-muted) text-[14px]">
      {t('nothingPending')}
    </p>
  );
}

function NeedRow({ item }: { item: ActionItem }) {
  const t = useTranslations('adminShell.dashboard');
  return (
    <li className="flex items-baseline justify-between gap-3 py-2 border-b border-(--color-rule)/60 last:border-b-0">
      <div>
        <div className="font-serif text-(--color-ink) text-[15px]">{item.label}</div>
        <div className="mono text-[10px] tracking-[0.06em] text-(--color-muted) mt-0.5">{item.sub}</div>
      </div>
      <Link href={item.href} className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) hover:text-(--color-ink)">
        <span data-testid={`dashboard-jump-${item.key}`}>{t('review')}</span>
      </Link>
    </li>
  );
}

function GroupHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between pb-3 border-b border-(--color-rule) mb-4">
      <h3 className="mono text-[10px] tracking-[0.22em] uppercase text-(--color-ink) m-0">{title}</h3>
      {action}
    </div>
  );
}


function ErrorBlock({ msg }: { msg: string | null }) {
  return msg === null ? null : (
    <p className="mt-6 mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent)" data-testid="dashboard-error">
      {msg}
    </p>
  );
}
