// InferenceUsagePanel —— #106 计费:owner 近 7 天 LLM 用量小表(按天×model)+ 合计。
// owner-key 调用才计(BYOAI 访客自付不计)。数据 GET /api/admin/inference-usage。

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
      {/* 三态交给 ListPane（F-L-53）：还在拉 → 骨架；没拉到 → 说没拉到；
          拉到了且是空的 → 才说「过去 7 天没有调用」。那句话是关于世界的陈述，
          只有真的知道的时候才配说。 */}
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

// total 为 null = 还没拉到。三个数一起变成 `—`：**报一个零就是断言这台实例没花过钱**，
// 而那一刻它还不知道（F-L-53）。跟仪表盘四个大数字用的是同一个记号。
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
