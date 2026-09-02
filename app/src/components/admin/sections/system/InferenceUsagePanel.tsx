// InferenceUsagePanel — #106 billing: owner's last-7-days LLM usage table
// (by day x model) + totals. Only owner-key calls count (BYOAI visitors pay their
// own way and aren't counted). Data via GET /api/admin/inference-usage.

'use client';

import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import {
  totalCells, useInferenceUsage, type UsageRow, type UsageTotal,
} from '@/lib/admin/use-inference-usage';

export function InferenceUsagePanel() {
  const t = useTranslations('adminShell.inferenceUsage');
  const usage = useInferenceUsage();
  return (
    <div
      className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50"
      data-testid="inference-usage-panel"
    >
      <AdminSectionHead className="mb-3">{t('title')}</AdminSectionHead>
      <UsageTotals total={usage.total} />
      {/* The three states go through ListPane (F-L-53): still fetching → skeleton;
          fetch failed → say so; fetched and empty → only then say "no calls in the
          last 7 days". That's a claim about the world, and it's only earned once we
          actually know it. */}
      <ListPane
        status={usage.status}
        count={usage.rows.length}
        empty={
          <p className="mono text-[11px] text-(--color-faint) mt-2" data-testid="inference-usage-empty">
            {t('empty')}
          </p>
        }
      >
        <table className="w-full mono text-[11px] mt-3" data-testid="inference-usage-table">
          <thead className="text-(--color-faint)">
            <tr className="text-left">
              <th className="py-1 font-normal">{t('colDate')}</th>
              <th className="py-1 font-normal">{t('colModel')}</th>
              <th className="py-1 font-normal text-right">{t('colCalls')}</th>
              <th className="py-1 font-normal text-right">{t('colIn')}</th>
              <th className="py-1 font-normal text-right">{t('colOut')}</th>
            </tr>
          </thead>
          <tbody>
            {usage.rows.map((r) => (
              <UsageRowLine key={`${r.date}-${r.model}`} row={r} />
            ))}
          </tbody>
        </table>
      </ListPane>
    </div>
  );
}

// total === null means not fetched yet. All three numbers become `—` together:
// **reporting a zero would assert this instance has never spent a cent**, and at
// that moment it doesn't actually know (F-L-53). Same convention as the dashboard's
// four big numbers.
function UsageTotals({ total }: { total: UsageTotal | null }) {
  const t = useTranslations('adminShell.inferenceUsage');
  const cells = totalCells(total, { calls: t('colCalls'), in: t('colIn'), out: t('colOut') });
  return (
    <div className="flex gap-6 mono text-[13px]" data-testid="inference-usage-total">
      {cells.map((c) => (
        <span key={c.label}>
          {c.value} <span className="text-(--color-faint) text-[10px]">{c.label}</span>
        </span>
      ))}
    </div>
  );
}

function UsageRowLine({ row }: { row: UsageRow }) {
  return (
    <tr className="border-t border-(--color-rule)/50">
      <td className="py-1">{row.date}</td>
      <td className="py-1">{row.model}</td>
      <td className="py-1 text-right">{row.calls}</td>
      <td className="py-1 text-right">{row.input_tokens.toLocaleString()}</td>
      <td className="py-1 text-right">{row.output_tokens.toLocaleString()}</td>
    </tr>
  );
}
