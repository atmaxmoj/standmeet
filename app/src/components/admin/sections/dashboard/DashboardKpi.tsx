// DashboardKpi —— the four KPI tiles at the top of /admin/dashboard. Split out of DashboardSection
// to keep that file under the line cap. Copy resolves from adminShell.dashboard.kpi via t(); the
// testid keys off card.key (stable), never the translated label.

'use client';

import { useTranslations } from 'next-intl';

import {
  kpiCards, type KpiCard, type KpiTrend as KpiTrendData,
} from '@/lib/admin/dashboard-view';
import type { DashboardStats } from '@/lib/admin/use-admin-dashboard';

// KpiRow —— the value and the small line below it are both computed in one place, `kpiCards`
// (F-L-52). This layer only renders: when there's no data, that small line simply doesn't exist.
export function KpiRow({ stats }: { stats: DashboardStats | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" data-testid="dashboard-kpis">
      {kpiCards(stats).map((c) => <Kpi key={c.key} card={c} />)}
    </div>
  );
}

function Kpi({ card }: { card: KpiCard }) {
  const t = useTranslations('adminShell.dashboard');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50" data-testid={`kpi-${card.key}`}>
      <div className="sm-smallcaps mb-1.5">{t(`kpi.${card.labelKey}`)}</div>
      <div className="font-serif text-(--color-ink) text-[34px] tabular-nums leading-none tracking-[-0.02em]">
        {card.value}
      </div>
      <KpiTrend trend={card.trend} subKey={card.subKey} />
    </div>
  );
}

function KpiTrend({ trend, subKey }: { trend?: KpiTrendData; subKey?: string }) {
  const hasTrend = (trend ?? subKey) !== undefined;
  return hasTrend ? <KpiTrendBody trend={trend} subKey={subKey} /> : null;
}

function KpiTrendBody({ trend, subKey }: { trend?: KpiTrendData; subKey?: string }) {
  const tone = trend?.up ? 'text-(--color-accent)' : 'text-(--color-muted)';
  return (
    <div className={`mono text-[10px] tracking-[0.06em] mt-1.5 ${tone}`}>
      <KpiTrendText trend={trend} /><KpiTrendSub subKey={subKey} />
    </div>
  );
}

function KpiTrendText({ trend }: { trend?: KpiTrendData }) {
  const t = useTranslations('adminShell.dashboard');
  return trend ? <>{t(`kpi.${trend.key}`, { n: trend.n ?? 0 })}</> : null;
}

function KpiTrendSub({ subKey }: { subKey?: string }) {
  const t = useTranslations('adminShell.dashboard');
  return subKey ? <span className="text-(--color-faint)"> · {t(`kpi.${subKey}`)}</span> : null;
}
