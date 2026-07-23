// DashboardSection —— /admin/dashboard。design 源 admin.js DashboardSection
// (199-311)：row 1 = 4 KPI stats; row 2 = corpus pulse sparkline (14d) +
// jobs heat card; row 3 = recent visitors table + needs-your-hand action list。

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import Link from 'next/link';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { fetchItemCount, fetchRecentConversations, type DashboardRecentRow } from '@/lib/admin/dashboard-fetch';
import { Sparkline } from '@/components/admin/atoms/Sparkline';
import {
  allActionItems,
  useAdminDashboard,
  type ActionItem,
  type DashboardStats,
} from '@/lib/admin/use-admin-dashboard';

export function DashboardSection() {
  const { stats, loading, error } = useAdminDashboard();
  return (
    <div data-testid="dashboard">
      <SectionHeader
        kicker="overview"
        title="dashboard"
        count={loading ? 'loading…' : 'last refresh · now'}
      />
      <KpiRow stats={stats} loading={loading} />
      <MiddleRow stats={stats} />
      <BottomRow stats={stats} />
      <ErrorBlock msg={error} />
    </div>
  );
}

function KpiRow({ stats, loading }: { stats: DashboardStats; loading: boolean }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" data-testid="dashboard-kpis">
      <Kpi label="entries" value={stats.rawCount} trend={`↑ ${stats.rawCount} total`} sub="raw + wiki + output" loading={loading} />
      <Kpi label="unprocessed" value={stats.rawUnprocessed} trend={stats.rawUnprocessed > 5 ? '↑ growing' : '↓ in flow'} sub="needs review" loading={loading} />
      <Kpi label="codes live" value={stats.codesLive} trend={`${stats.codesLive} active`} loading={loading} />
      <Kpi label="requests" value={stats.requestsNew} trend={stats.requestsNew > 0 ? `↑ ${stats.requestsNew} new` : 'at zero'} sub="from gate" loading={loading} />
    </div>
  );
}

function Kpi({ label, value, trend, sub, loading }: {
  label: string; value: number; trend?: string; sub?: string; loading: boolean;
}) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid={`kpi-${label}`}>
      <div className="sm-smallcaps mb-1.5">{label}</div>
      <div className="font-serif text-(--color-ink) text-[34px] tabular-nums leading-none tracking-[-0.02em]">
        {loading ? '—' : value.toLocaleString()}
      </div>
      <KpiTrend trend={trend} sub={sub} />
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

function MiddleRow({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 mb-6">
      <CorpusPulse stats={stats} />
      <JobsHeat />
    </div>
  );
}

function CorpusPulse({ stats }: { stats: DashboardStats }) {
  const t = useTranslations('adminShell.dashboard');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <GroupHeader title="corpus pulse · 14d" action={
        <span className="mono text-[10px] text-(--color-accent)">{t('corpusActive')}</span>
      } />
      <div className="flex items-end gap-6 mt-2">
        <div>
          <div className="font-serif text-(--color-ink) text-[34px] tabular-nums leading-none">
            {stats.rawCount.toLocaleString()}
          </div>
          <div className="mono text-[10px] text-(--color-muted) tracking-[0.06em] mt-1">
            {t('entriesTotal')}
          </div>
        </div>
        <div className="flex-1">
          <CorpusSparkline pulse={stats.pulse} days={stats.pulseDays} />
          <div className="mono text-[9.5px] text-(--color-faint) tracking-[0.06em] mt-1 flex justify-between">
            <span>{t('daysAgo14')}</span><span>{t('today')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// CorpusSparkline —— 画**真** series（rot-A1）。空实例 → 空 pulse → 平线，正是诚实的形态；
// 曾经这里是硬编码的 MOCK_14D，一条永远不动、跟 corpus 无关的锯齿。
function CorpusSparkline({ pulse, days }: { pulse: readonly number[]; days: readonly string[] }) {
  return <Sparkline data={pulse} labels={days} width={260} height={48} label="corpus pulse · 14d" />;
}

function JobsHeat() {
  const t = useTranslations('adminShell.dashboard');
  const { sent } = useApplicationCount();
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <GroupHeader title="jobs · active loop" action={
        <Link href="/admin/listings" className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)">
          {t('viewAll')}
        </Link>
      } />
      <div className="grid grid-cols-2 gap-3 mt-2">
        <div>
          <div className="sm-smallcaps mb-1">{t('shortlist')}</div>
          <div className="font-serif text-(--color-ink) text-[34px] tabular-nums leading-none">0</div>
        </div>
        <div>
          <div className="sm-smallcaps mb-1">{t('sent')}</div>
          <StatCount state={sent} testid="dash-applications-sent" />
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-(--color-rule)/60">
        <div className="sm-smallcaps mb-1">{t('topMatch')}</div>
        <JobsTopMatch />
      </div>
    </div>
  );
}

// CountState —— 三态，不是「数字或空」。「还在拉」和「没拉到」必须分开：把两者并成同一个空值，
// 就没人能分清此刻是 loading 还是 failed —— 连测试都分不清（这条 spec 的第一版正是这么假绿的）。
// 「0 sent」是一句关于事实的陈述；GET 挂了的时候事实不是 0，是不知道（F-A-13 的同类）。
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

// StatCount —— 三态各有各的字面：'…' 还在拉、'—' 没拉到、数字 = 真数字。'—' **只**代表失败。
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

function JobsTopMatch() {
  const t = useTranslations('adminShell.dashboard');
  return (
    <>
      <div className="font-serif text-[16px] text-(--color-muted) italic">
        {t('registerSources')}
      </div>
      <div className="mono text-[10px] text-(--color-faint) tracking-[0.06em] mt-1">
        {t('sourcesHint')}
      </div>
    </>
  );
}

function BottomRow({ stats }: { stats: DashboardStats }) {
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

// useRecentConversations —— null = 没拉到（不是"还没有访客"）。空列表的那句话是**关于世界的陈述**，
// 拉失败时它是假的（F-A-13 的同类）。
function useRecentConversations(): { rows: DashboardRecentRow[] | null } {
  const [rows, setRows] = useState<DashboardRecentRow[] | null>([]);
  useEffect(() => {
    void fetchRecentConversations('/api/admin/conversations/', 5)
      .then(setRows)
      .catch(() => setRows(null));
  }, []);
  return { rows };
}

function RecentVisitorsList({ rows }: { rows: readonly DashboardRecentRow[] | null }) {
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
        <div className="mono text-[10px] text-(--color-muted) mt-0.5">
          {t('visitorMeta', { label: row.code_label, turns: row.turns, last: row.last })}
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

function NeedsYourHand({ stats }: { stats: DashboardStats }) {
  const items = buildActionItems(stats);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid="needs-hand">
      <GroupHeader title="needs your hand" />
      <NeedsList items={items} />
    </div>
  );
}

function buildActionItems(stats: DashboardStats): ActionItem[] {
  return allActionItems(stats).filter((i) => i.count > 0);
}

function NeedsList({ items }: { items: ActionItem[] }) {
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
