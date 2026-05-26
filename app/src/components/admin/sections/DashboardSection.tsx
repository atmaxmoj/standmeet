// DashboardSection —— /admin/dashboard。4 KPI 卡 + "needs your hand" 列表。
//
// 设计源 docs/design/project/admin.js DashboardSection (199-311)。
// 缩减版：不画 14d corpus pulse sparkline 和 jobs heat（要 14d
// time-series endpoint + JOB_LISTINGS state）—— 先把 KPIs + needs-action
// 接通，sparkline 后面单独 commit。

'use client';

import Link from 'next/link';

import { SectionHeader } from '@/components/admin/SectionHeader';
import {
  useAdminDashboard,
  type DashboardStats,
} from '@/lib/admin/use-admin-dashboard';

export function DashboardSection() {
  const { stats, loading, error } = useAdminDashboard();
  return (
    <>
      <SectionHeader
        kicker="overview"
        title="dashboard"
        count={loading ? 'loading…' : 'last refresh · now'}
      />
      <Intro />
      <KpiGrid stats={stats} loading={loading} />
      <NeedsYourHand stats={stats} />
      <ErrorBlock msg={error} />
    </>
  );
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      At-a-glance — corpus growth, pending requests, active codes. Click any
      row to jump straight to the section that needs you.
    </p>
  );
}

function KpiGrid({ stats, loading }: { stats: DashboardStats; loading: boolean }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8" data-testid="dashboard-kpis">
      <Kpi label="entries" value={stats.rawCount} sub="raw + wiki + output" loading={loading} />
      <Kpi label="unprocessed" value={stats.rawUnprocessed} sub="needs review" loading={loading} />
      <Kpi label="codes live" value={stats.codesLive} sub="visitor access" loading={loading} />
      <Kpi label="requests" value={stats.requestsNew} sub="from /gate" loading={loading} />
    </div>
  );
}

function Kpi({ label, value, sub, loading }: {
  label: string; value: number; sub: string; loading: boolean;
}) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/40">
      <div className="sm-smallcaps">{label}</div>
      <div className="font-serif text-(--color-ink) text-[36px] tabular-nums leading-none mt-2 mb-1">
        {loading ? '—' : value.toLocaleString()}
      </div>
      <div className="mono text-[10px] tracking-[0.06em] text-(--color-muted)">{sub}</div>
    </div>
  );
}

function NeedsYourHand({ stats }: { stats: DashboardStats }) {
  const items = buildActionItems(stats);
  return (
    <section className="border border-(--color-rule) rounded-[3px] p-4 max-w-[640px]">
      <div className="sm-smallcaps mb-3">needs your hand</div>
      <NeedsList items={items} />
    </section>
  );
}

interface ActionItem {
  key: string;
  count: number;
  label: string;
  sub: string;
  href: string;
}

function buildActionItems(stats: DashboardStats): ActionItem[] {
  return [
    {
      key: 'requests', count: stats.requestsNew,
      label: 'access request' + (stats.requestsNew === 1 ? '' : 's'),
      sub: 'visitors waiting on a code',
      href: '/admin/requests',
    },
    {
      key: 'raw', count: stats.rawUnprocessed,
      label: 'raw ' + (stats.rawUnprocessed === 1 ? 'entry' : 'entries') + ' unprocessed',
      sub: 'promote, edit, or archive',
      href: '/admin/raw',
    },
  ].filter((i) => i.count > 0);
}

function NeedsList({ items }: { items: ActionItem[] }) {
  return items.length === 0
    ? <EmptyAction />
    : (
      <ul className="flex flex-col gap-3" data-testid="dashboard-needs">
        {items.map((i) => <NeedRow key={i.key} item={i} />)}
      </ul>
    );
}

function EmptyAction() {
  return (
    <p className="reading text-(--color-muted) text-[14px]">
      Nothing pending — corpus is current.
    </p>
  );
}

function NeedRow({ item }: { item: ActionItem }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <div>
        <div className="font-serif text-(--color-ink) text-[15.5px]">
          <span className="tabular-nums">{item.count}</span>{' '}{item.label}
        </div>
        <div className="mono text-[10px] tracking-[0.06em] text-(--color-muted) mt-0.5">
          {item.sub}
        </div>
      </div>
      <Link
        href={item.href}
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) hover:text-(--color-ink)"
      >
        <span data-testid={`dashboard-jump-${item.key}`}>review →</span>
      </Link>
    </li>
  );
}

function ErrorBlock({ msg }: { msg: string | null }) {
  return msg === null ? null : (
    <p
      className="mt-6 mono text-[11px] tracking-[0.14em] uppercase text-(--color-accent)"
      data-testid="dashboard-error"
    >
      {msg}
    </p>
  );
}
