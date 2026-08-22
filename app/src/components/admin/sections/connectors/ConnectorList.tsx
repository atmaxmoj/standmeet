// ConnectorList —— owner 已配的连接器（上传 openapi + 协议）一行一个：品类 + 状态 + 来源徽章
// （uploaded / built-in）+ 删除。归一鈦的列表（替代手搓 gcal-specific 卡的逐条罗列）。
// 数据来自 use-connector-list（GET /api/admin/connectors）。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ConnectorCardBody } from '@/components/admin/sections/connectors/ConnectorCard';
import {
  originOf, type ConnectorListHook, type ConnectorRow,
} from '@/lib/admin/use-connector-list';
import { useAction } from '@/lib/ui/use-action';

export function ConnectorList({ hook }: { hook: ConnectorListHook }) {
  const run = useAction();
  const t = useTranslations('adminIntegrations.connectors');
  // 只列 owner 自建（上传/协议）连接器；内置（已配的 gcal/smtp…）是 catalog 卡，不在这重复渲染，
  // 否则配好的内置会同时以 connector-row-{id}（卡）和 connector-row-{category}（这）出现，撞 testid。
  const uploaded = hook.connectors.filter((c) => originOf(c) === 'uploaded');
  // loadError 时哪怕列表空也要出提示：空 vs「没拉到」owner 分得清（§2 不静默成空）。
  return (!hook.loadError && uploaded.length === 0) ? null : (
    <div className="mb-8 space-y-3">
      <AdminSectionHead className="mb-3" aside={t('uploadedCount', { count: String(uploaded.length) })}>
        {t('uploadedHeading')}
      </AdminSectionHead>
      <LoadError show={hook.loadError} />
      {uploaded.map((row) => (
        <ConnectorRowItem
          key={row.id}
          row={row}
          onDelete={() => { void run(() => hook.remove(row.id), { success: 'Connector removed' }); }}
        />
      ))}
    </div>
  );
}

// LoadError —— 列表没拉到时的提示（§2：空列表 vs 加载失败要分得清）。
function LoadError({ show }: { show: boolean }) {
  const t = useTranslations('adminIntegrations.connectorList');
  return show ? (
    <p data-testid="connector-list-error" className="mono text-[11px] text-(--color-accent)">
      {t('loadError')}
    </p>
  ) : null;
}

// ConnectorRowItem —— owner 自己传进来的那一族。**跟内置卡共用同一个主体**
// （`ConnectorCardBody`）：品类名和状态由它渲，这里只多出「来源 / kind / 删除」那一行。
//
// 原先这里只有那一行，没有凭据表单也没有 CONNECT —— 传得进来、连不上去（F-C-47）。
// 品类名和状态**只许有一处**：它们本来在这里各画一遍（`connector-status` 曾经是这一行的），
// 共用主体之后由 CardHead 负责，否则同一格上会压着第二串字。
function ConnectorRowItem({ row, onDelete }: { row: ConnectorRow; onDelete: () => void }) {
  return (
    <li
      data-testid={`connector-row-${row.category}`}
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-4"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <div className="flex items-center gap-2 mb-2">
        <OriginBadge row={row} />
        <span className="mono text-[10px] text-(--color-faint)">{row.kind}</span>
        <span className="ml-auto"><DeleteControl onDelete={onDelete} /></span>
      </div>
      <ConnectorCardBody entry={row} />
    </li>
  );
}

function OriginBadge({ row }: { row: ConnectorRow }) {
  // not-connected 文案需避开 "connected" 子串（测试 .not.toHaveText）；origin 同理避开对方关键词。
  return (
    <span
      data-testid="connector-origin-badge"
      className="inline-flex items-center px-1.5 py-0.5 border border-(--color-rule) rounded-sm mono text-[10px] lowercase"
    >
      {originOf(row)}
    </span>
  );
}

// DeleteControl —— ✕ → 确认（破坏性二段）。✕ 的可达名是 "✕"（不撞 /delete|remove/，避免与确认按钮
// strict-mode 冲突）；确认按钮文案 "Delete" 才匹配测试的 getByRole(name:/delete/)。
function DeleteControl({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const t = useTranslations('adminIntegrations.connectorList');
  const tc = useTranslations('adminIntegrations.common');
  return confirming ? (
    <button
      type="button" onClick={onDelete}
      className="shrink-0 sm-btn sm-btn-solid sm-btn-sm"
    >
      {t('delete')}
    </button>
  ) : (
    <button
      type="button"
      data-testid="connector-delete-button"
      aria-label="remove connector"
      onClick={() => setConfirming(true)}
      className="shrink-0 mono text-[13px] text-(--color-muted) hover:text-(--color-accent) transition-colors"
    >
      {tc('close')}
    </button>
  );
}
