// InferenceUsagePanel —— #106 计费:owner 近 7 天 LLM 用量小表(按天×model)+ 合计。
// owner-key 调用才计(BYOAI 访客自付不计)。数据 GET /api/admin/inference-usage。

'use client';

import { useTranslations } from 'next-intl';

import { useInferenceUsage, type UsageRow } from '@/lib/admin/use-inference-usage';

export function InferenceUsagePanel() {
  const t = useTranslations('adminShell.inferenceUsage');
  const usage = useInferenceUsage();
  return (
    <div
      className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50"
      data-testid="inference-usage-panel"
    >
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) mb-3">
        {t('title')}
      </div>
      <UsageTotals
        calls={usage.total.calls}
        inTok={usage.total.input_tokens}
        outTok={usage.total.output_tokens}
      />
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
      {usage.rows.length === 0 && (
        <p className="mono text-[11px] text-(--color-faint) mt-2" data-testid="inference-usage-empty">
          {t('empty')}
        </p>
      )}
    </div>
  );
}

function UsageTotals({ calls, inTok, outTok }: { calls: number; inTok: number; outTok: number }) {
  const t = useTranslations('adminShell.inferenceUsage');
  return (
    <div className="flex gap-6 mono text-[13px]" data-testid="inference-usage-total">
      <span>{calls} <span className="text-(--color-faint) text-[10px]">{t('colCalls')}</span></span>
      <span>{inTok.toLocaleString()} <span className="text-(--color-faint) text-[10px]">{t('colIn')}</span></span>
      <span>{outTok.toLocaleString()} <span className="text-(--color-faint) text-[10px]">{t('colOut')}</span></span>
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
