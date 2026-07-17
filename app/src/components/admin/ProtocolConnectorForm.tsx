// ProtocolConnectorForm —— #155 §8-E：protocol 连接器（SMTP/CalDAV）的固定凭据表单 + 连接测试。
// 固定字段（非 spec 派生）走通用 ConnectorConfigForm 渲染；save 建连接器 + 存凭据，随后出
// Connect 按钮做真连接测试 → status / 友好错误（connect/tls/auth）。

'use client';

import { useTranslations } from 'next-intl';

import { ConnectorConfigForm } from '@/components/admin/ConnectorConfigForm';
import { useProtocolConnect } from '@/lib/admin/use-protocol-connect';
import type { ConnectorEntry } from '@/lib/admin/connector-registry';

export function ProtocolConnectorForm({ entry, onClose }: { entry: ConnectorEntry; onClose: () => void }) {
  const hook = useProtocolConnect(entry.protocol ?? '', entry.protocolCategory ?? '');
  return (
    <div className="sm-connector-modal-body">
      <ConnectorConfigForm entry={entry} onCancel={onClose} onSave={hook.save} />
      <ConnectStep saved={hook.saved} status={hook.status} error={hook.error} onConnect={hook.connect} />
    </div>
  );
}

function ConnectStep({
  saved, status, error, onConnect,
}: { saved: boolean; status: string; error: string; onConnect: () => void }) {
  const t = useTranslations('adminShell.protocolConnector');
  return saved ? (
    <div className="border-t border-(--color-rule)/60 pt-4 mt-4 space-y-2">
      <button
        type="button" onClick={onConnect}
        data-testid="connector-connect-button"
        className="sm-btn sm-btn-solid sm-btn-sm"
      >
        {t('testConnection')}
      </button>
      <StatusLine status={status} />
      <ErrorLine error={error} />
    </div>
  ) : null;
}

function StatusLine({ status }: { status: string }) {
  // not-connected 文案不能含 "connected" 子串（测试 .not.toHaveText(/connected/i)）。
  return (
    <p data-testid="connector-status" className="mono text-[12px] text-(--color-muted)">
      {status === 'connected' ? 'connected' : 'not linked yet'}
    </p>
  );
}

function ErrorLine({ error }: { error: string }) {
  return error === '' ? null : (
    <p data-testid="connector-error" className="mono text-[12px] text-(--color-accent)">
      {error}
    </p>
  );
}
