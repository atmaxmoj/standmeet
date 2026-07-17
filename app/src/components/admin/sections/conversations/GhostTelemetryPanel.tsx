// GhostTelemetryPanel —— the per-waypoint ghost-steering funnel above the conversations table.
// Shows, per waypoint the policy has steered toward, how many ghosts were shown vs accepted (Tab)
// and the acceptance rate — the owner's read on which steering nudges land. Hidden until there is
// at least one policy ghost (no empty scaffolding).

'use client';

import { useTranslations } from 'next-intl';

import { useGhostTelemetryView, pct, type WaypointStat } from '@/lib/admin/use-ghost-telemetry';

export function GhostTelemetryPanel() {
  const t = useTranslations('adminAccess');
  const { visible, waypoints, totals } = useGhostTelemetryView();
  return visible ? (
    <div
      data-testid="ghost-telemetry-panel"
      className="mb-5 border border-(--color-rule) rounded-sm bg-(--color-surface)/20 px-3 py-2.5"
    >
      <div className="mono text-[9.5px] tracking-[0.2em] uppercase text-(--color-muted) mb-2">
        {t('ghostTelemetry.title')}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="mono text-[9px] tracking-[0.16em] uppercase text-(--color-faint)">
            <th className="text-left px-1 py-1 font-normal">{t('ghostTelemetry.thWaypoint')}</th>
            <th className="text-right px-1 py-1 font-normal">{t('ghostTelemetry.thShown')}</th>
            <th className="text-right px-1 py-1 font-normal">{t('ghostTelemetry.thAccepted')}</th>
            <th className="text-right px-1 py-1 font-normal">{t('ghostTelemetry.thRate')}</th>
          </tr>
        </thead>
        <tbody>
          {waypoints.map((wp) => <WaypointRow key={wp.target_waypoint} wp={wp} />)}
          <TotalsRow shown={totals.shown} accepted={totals.accepted} rate={totals.acceptance_rate} />
        </tbody>
      </table>
    </div>
  ) : null;
}

function WaypointRow({ wp }: { wp: WaypointStat }) {
  return (
    <tr data-testid="ghost-telemetry-row" className="border-t border-(--color-rule)/50">
      <td className="px-1 py-1.5 mono text-[11px] text-(--color-ink)">{wp.target_waypoint}</td>
      <td className="px-1 py-1.5 text-right mono text-[11.5px] tabular-nums text-(--color-muted)">{wp.shown}</td>
      <td className="px-1 py-1.5 text-right mono text-[11.5px] tabular-nums text-(--color-muted)">{wp.accepted}</td>
      <td className="px-1 py-1.5 text-right mono text-[11.5px] tabular-nums text-(--color-accent)">{pct(wp.acceptance_rate)}</td>
    </tr>
  );
}

function TotalsRow({ shown, accepted, rate }: { shown: number; accepted: number; rate: number }) {
  const t = useTranslations('adminAccess');
  return (
    <tr className="border-t border-(--color-rule)">
      <td className="px-1 pt-1.5 mono text-[9px] tracking-[0.16em] uppercase text-(--color-faint)">{t('ghostTelemetry.all')}</td>
      <td className="px-1 pt-1.5 text-right mono text-[11.5px] tabular-nums text-(--color-ink)">{shown}</td>
      <td className="px-1 pt-1.5 text-right mono text-[11.5px] tabular-nums text-(--color-ink)">{accepted}</td>
      <td className="px-1 pt-1.5 text-right mono text-[11.5px] tabular-nums text-(--color-ink)">{pct(rate)}</td>
    </tr>
  );
}
