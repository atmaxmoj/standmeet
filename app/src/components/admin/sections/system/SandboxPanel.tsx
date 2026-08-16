// SandboxPanel —— #147 admin 管理 MCP 沙箱:列活跃 per-session 工作区 + 一键清扫过期。
// 后端 sandboxws.Manager + cron sweep(#148);这里是 owner-authed 管理面。数据走
// /api/admin/sandbox/*。sweep 是 owner 手动触发的清理(cron 之外的按需)。

'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
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
      {/* 标题走 AdminSectionHead（12px + 朱红竖条）—— 跟 api·mcp 的六个大节同一个骨架。
          这一块以前是个裸的 10px mono div，跟字段名同一号，扫页时看不出「这里开始新的一节」。 */}
      {/* 扫除按钮挂在标题那条线的右端（`aside`）—— 之前它在标题外面另起一个 flex 行，那条
          横线就只画到按钮前面为止，跟同一页另外五张卡的整幅横线对不上。
          **没有 workspace 时它是禁用的**（F-E-26）：一颗永远可点、有时无事发生的按钮，
          会把「没生效」教成正常（同族：F-C-24 画上去的 CONNECT、F-D-13 那颗访客看不见的
          dock 按钮）。理由不只挂在 title 上 —— 禁用的按钮 hover 事件都未必来；
          底下那块空态（`sandbox-empty`）本来就写着「现在一个都没有、什么时候会有」。 */}
      <AdminSectionHead
        className="mb-3"
        aside={
          <button
            className="sm-btn sm-btn-outline sm-btn-sm" type="button"
            data-testid="sandbox-sweep" onClick={onSweep}
            disabled={sandbox.workspaces.length === 0}
            title={sandbox.workspaces.length === 0 ? t('sweepNothing') : undefined}
          >
            {t('sweepNow')}
          </button>
        }
      >
        {t('title', { n: sandbox.workspaces.length })}
      </AdminSectionHead>
      <WorkspaceBody rows={sandbox.workspaces} />
    </div>
  );
}

// WorkspaceBody —— 有 workspace 时列表格；没有时走 `.sm-empty`（UX-75 收口的那一个），
// 而且**说清什么时候会有** —— 一句「没有」自己回答不了「是没人用过，还是坏了」。
function WorkspaceBody({ rows }: { rows: readonly SandboxWorkspace[] }) {
  const t = useTranslations('adminShell.sandbox');
  return rows.length === 0 ? (
    <div className="sm-empty" data-testid="sandbox-empty">
      <div className="sm-empty-title">{t('empty')}</div>
      <p className="sm-empty-hint">{t('emptyHint')}</p>
    </div>
  ) : (
    <table className="w-full mono text-[11px]" data-testid="sandbox-table">
      <thead className="text-(--color-faint)">
        <tr className="text-left">
          <th className="py-1 font-normal">{t('colWorkspace')}</th>
          <th className="py-1 font-normal text-right">{t('colAge')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((w) => <WorkspaceRow key={w.id} ws={w} />)}
      </tbody>
    </table>
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
