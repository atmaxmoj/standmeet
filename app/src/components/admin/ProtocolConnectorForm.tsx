// ProtocolConnectorForm —— #155 §8-E: fixed credential form + connection test for protocol
// connectors (SMTP/CalDAV). Fixed fields (not spec-derived) render through the generic
// ConnectorConfigForm; save creates the connector + stores credentials, then a Connect button
// does a real connection test -> status / a friendly error (connect/tls/auth).

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
  // The not-connected copy must not contain the substring "connected" (test asserts
  // .not.toHaveText(/connected/i)).
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
