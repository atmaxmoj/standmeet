// ProtocolSupplierForm —— #155 §8-E: fixed credential form + connection test for protocol
// suppliers (SMTP/CalDAV). Fixed fields (not spec-derived) render through the generic
// SupplierConfigForm; save creates the supplier + stores credentials, then a Connect button
// does a real connection test -> status / a friendly error (connect/tls/auth).

'use client';

import { useTranslations } from 'next-intl';

import { SupplierConfigForm } from '@/components/admin/SupplierConfigForm';
import { useProtocolConnect } from '@/lib/admin/use-protocol-connect';
import type { SupplierEntry } from '@/lib/admin/supplier-registry';

export function ProtocolSupplierForm({ entry, onClose }: { entry: SupplierEntry; onClose: () => void }) {
  const hook = useProtocolConnect(entry.protocol ?? '', entry.protocolSeam ?? '');
  return (
    <div className="sm-supplier-modal-body">
      <SupplierConfigForm entry={entry} onCancel={onClose} onSave={hook.save} />
      <ConnectStep saved={hook.saved} status={hook.status} error={hook.error} onConnect={hook.connect} />
    </div>
  );
}

function ConnectStep({
  saved, status, error, onConnect,
}: { saved: boolean; status: string; error: string; onConnect: () => void }) {
  const t = useTranslations('adminShell.protocolSupplier');
  return saved ? (
    <div className="border-t border-(--color-rule)/60 pt-4 mt-4 space-y-2">
      <button
        type="button" onClick={onConnect}
        data-testid="supplier-connect-button"
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
    <p data-testid="supplier-status" className="mono text-[12px] text-(--color-muted)">
      {status === 'connected' ? 'connected' : 'not linked yet'}
    </p>
  );
}

function ErrorLine({ error }: { error: string }) {
  return error === '' ? null : (
    <p data-testid="supplier-error" className="mono text-[12px] text-(--color-accent)">
      {error}
    </p>
  );
}
