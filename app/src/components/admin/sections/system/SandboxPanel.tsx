// SandboxPanel —— #147 admin 管理 MCP 沙箱:列活跃 per-session 工作区 + 一键清扫过期。
// 后端 sandboxws.Manager + cron sweep(#148);这里是 owner-authed 管理面。数据走
// /api/admin/sandbox/*。sweep 是 owner 手动触发的清理(cron 之外的按需)。

'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { useSandbox, type SandboxWorkspace } from '@/lib/admin/use-sandbox';
import { useAction } from '@/lib/ui/use-action';

export function SandboxPanel() {
  const t = useTranslations('adminShell.sandbox');
  const sandbox = useSandbox();
  const run = useAction();
  const onSweep = useCallback(
    () => run(() => sandbox.sweep(), { success: 'Swept expired sandbox workspaces' }),
    [run, sandbox],
  );
  return (
    <div
      className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 lg:col-span-2"
      data-testid="sandbox-panel"
    >
      <div className="flex items-baseline justify-between mb-3">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint)">
          {t('title', { n: sandbox.workspaces.length })}
        </div>
        <button
          className="sm-btn sm-btn-outline sm-btn-sm" type="button"
          data-testid="sandbox-sweep" onClick={onSweep}
        >
          {t('sweepNow')}
        </button>
      </div>
      <table className="w-full mono text-[11px]" data-testid="sandbox-table">
        <thead className="text-(--color-faint)">
          <tr className="text-left">
            <th className="py-1 font-normal">{t('colWorkspace')}</th>
            <th className="py-1 font-normal text-right">{t('colAge')}</th>
          </tr>
        </thead>
        <tbody>
          {sandbox.workspaces.map((w) => (
            <WorkspaceRow key={w.id} ws={w} />
          ))}
        </tbody>
      </table>
      {sandbox.workspaces.length === 0 && (
        <p className="mono text-[11px] text-(--color-faint) mt-2" data-testid="sandbox-empty">
          {t('empty')}
        </p>
      )}
    </div>
  );
}

function WorkspaceRow({ ws }: { ws: SandboxWorkspace }) {
  const t = useTranslations('adminShell.sandbox');
  return (
    <tr className="border-t border-(--color-rule)/40">
      <td className="py-1 text-(--color-muted)">{ws.id}</td>
      <td className="py-1 text-right text-(--color-muted) tabular-nums">{t('ageSecs', { n: ws.age_secs })}</td>
    </tr>
  );
}
