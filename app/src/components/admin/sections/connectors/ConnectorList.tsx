// ConnectorList —— owner 已配的连接器（上传 openapi + 协议）一行一个：品类 + 状态 + 来源徽章
// （uploaded / built-in）+ 删除。归一鈦的列表（替代手搓 gcal-specific 卡的逐条罗列）。
// 数据来自 use-connector-list（GET /api/admin/connectors）。

'use client';

import { useState } from 'react';

import {
  originOf, type ConnectorListHook, type ConnectorRow,
} from '@/lib/admin/use-connector-list';

export function ConnectorList({ hook }: { hook: ConnectorListHook }) {
  return hook.connectors.length === 0 ? null : (
    <ul className="mb-8 space-y-3">
      {hook.connectors.map((row) => (
        <ConnectorRowItem key={row.id} row={row} onDelete={() => { void hook.remove(row.id); }} />
      ))}
    </ul>
  );
}

function ConnectorRowItem({ row, onDelete }: { row: ConnectorRow; onDelete: () => void }) {
  return (
    <li
      data-testid={`connector-row-${row.category}`}
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-4 flex items-center gap-3"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-(--color-ink)">{row.category}</span>
          <OriginBadge row={row} />
          <span className="mono text-[10px] text-(--color-faint)">{row.kind}</span>
        </div>
        <StatusLine connected={row.connected} />
      </div>
      <DeleteControl onDelete={onDelete} />
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

function StatusLine({ connected }: { connected: boolean }) {
  return (
    <p data-testid="connector-status" className="mono text-[11px] text-(--color-muted) mt-0.5">
      {connected ? 'connected' : 'not connected'}
    </p>
  );
}

// DeleteControl —— ✕ → 确认（破坏性二段）。✕ 的可达名是 "✕"（不撞 /delete|remove/，避免与确认按钮
// strict-mode 冲突）；确认按钮文案 "Delete" 才匹配测试的 getByRole(name:/delete/)。
function DeleteControl({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <button
      type="button" onClick={onDelete}
      className="shrink-0 sm-btn sm-btn-solid sm-btn-sm"
    >
      Delete
    </button>
  ) : (
    <button
      type="button"
      data-testid="connector-delete-button"
      aria-label="remove connector"
      onClick={() => setConfirming(true)}
      className="shrink-0 mono text-[13px] text-(--color-muted) hover:text-(--color-accent) transition-colors"
    >
      ✕
    </button>
  );
}
