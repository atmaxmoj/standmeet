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
      {/* 标题走 `.sm-section-h`（12px + 朱红竖条）—— 跟 api·mcp 的六个大节同一个骨架。
          这一块以前是个裸的 10px mono div，跟字段名同一号，扫页时看不出「这里开始新的一节」。 */}
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="sm-section-h grow border-b-0 pb-0">
          {t('title', { n: sandbox.workspaces.length })}
        </div>
        {/* 0 个 workspace 时这颗按钮点下去什么都不会发生 —— 那是 F-E-26，**不在设计列里改**：
            禁用它会改变一条守卫断言的行为，而设计列的边界是「纯呈现，改完不需要动测试」
            （[[设计列的边界]]）。这里只留 hover 时的一句说明，行为一个字没动。 */}
        <button
          className="sm-btn sm-btn-outline sm-btn-sm" type="button"
          data-testid="sandbox-sweep" onClick={onSweep}
          title={sandbox.workspaces.length === 0 ? t('sweepNothing') : undefined}
        >
          {t('sweepNow')}
        </button>
      </div>
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
