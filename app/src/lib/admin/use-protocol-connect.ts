// use-protocol-connect —— #155 §8-E: the assembly lifecycle for protocol
// suppliers (SMTP/CalDAV). The owner fills in a fixed credentials form →
// save (creates the protocol supplier + stores credentials) → connect (a
// real connection test) → status. The logic lives here; the form only renders + wires up.

import { useCallback, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const CreateSchema = z.object({ id: z.string() });
const ConnectSchema = z.object({
  connected: z.boolean(),
  error: z.string().nullish(),
});

export type ConnectStatus = 'idle' | 'connecting' | 'connected' | 'not-connected';

export interface ProtocolConnectHook {
  saved: boolean;
  status: ConnectStatus;
  error: string;
  save: (values: Record<string, string>) => void;
  connect: () => void;
  saveAndConnect: (values: Record<string, string>) => void;
}

// credsFor —— form values → protocol credentials JSON (unified: passed
// through as-is; only from → from_address is renamed to match the SMTP
// backend shape). SMTP uses host/port/username/password/from/tls; CalDAV uses
// url/username/password/tls — the same mapping works for both.
function credsFor(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...values };
  if (out.from !== undefined) {
    out.from_address = out.from;
    delete out.from;
  }
  return out;
}

export function useProtocolConnect(protocol: string, seam: string): ProtocolConnectHook {
  const [id, setId] = useState('');
  const [status, setStatus] = useState<ConnectStatus>('idle');
  const [error, setError] = useState('');

  const save = useCallback((values: Record<string, string>) => {
    void adminAPI.post('/suppliers', { kind: 'protocol', protocol, seam }, CreateSchema)
      .then((r) => adminAPI.postVoid(`/suppliers/${r.id}/credentials`, credsFor(values)).then(() => r.id))
      .then(setId)
      .catch(() => setError('Could not save the supplier configuration.'));
  }, [protocol, seam]);

  const applyConnect = useCallback((r: z.infer<typeof ConnectSchema>) => {
    setStatus(r.connected ? 'connected' : 'not-connected');
    setError(r.connected ? '' : (r.error ?? 'The connection test failed.'));
  }, []);

  const connect = useCallback(() => {
    setError('');
    void adminAPI.post(`/suppliers/${id}/connect`, {}, ConnectSchema)
      .then(applyConnect)
      .catch(() => { setStatus('not-connected'); setError('The connection test failed.'); });
  }, [id, applyConnect]);

  // saveAndConnect —— one click: create the protocol supplier + store
  // credentials → immediately run the connection test (the unified assemble
  // view's protocol path — the owner fills in the form and clicks Connect
  // once). Chains sequentially off the id returned by the previous step, avoiding the save→connect state race.
  const saveAndConnect = useCallback((values: Record<string, string>) => {
    setError('');
    setStatus('connecting'); // Flips to connecting… synchronously, so expectConnected really waits for connect to land (won't be loosely matched by "not connected")

    void adminAPI.post('/suppliers', { kind: 'protocol', protocol, seam }, CreateSchema)
      .then((r) => {
        setId(r.id);
        return adminAPI.postVoid(`/suppliers/${r.id}/credentials`, credsFor(values))
          .then(() => adminAPI.post(`/suppliers/${r.id}/connect`, {}, ConnectSchema));
      })
      .then(applyConnect)
      .catch(() => { setStatus('not-connected'); setError('The connection test failed.'); });
  }, [protocol, seam, applyConnect]);

  return { saved: id !== '', status, error, save, connect, saveAndConnect };
}
