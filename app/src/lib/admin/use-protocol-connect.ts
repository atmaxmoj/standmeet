// use-protocol-connect —— #155 §8-E：protocol 连接器（SMTP/CalDAV）的装配生命周期。owner 填固定
// 凭据表单 → save（建 protocol 连接器 + 存凭据）→ connect（真连接测试）→ status。逻辑住这里，
// 表单只渲染 + 连线。

import { useCallback, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const CreateSchema = z.object({ id: z.string() });
const ConnectSchema = z.object({
  connected: z.boolean(),
  error: z.string().nullish(),
});

export type ConnectStatus = 'idle' | 'connected' | 'not-connected';

export interface ProtocolConnectHook {
  saved: boolean;
  status: ConnectStatus;
  error: string;
  save: (values: Record<string, string>) => void;
  connect: () => void;
}

// credsFor —— 表单值 → SMTP 凭据 JSON（from → from_address；其余同名）。
function credsFor(values: Record<string, string>): Record<string, string> {
  return {
    host: values.host ?? '',
    port: values.port ?? '',
    username: values.username ?? '',
    password: values.password ?? '',
    from_address: values.from ?? '',
    tls: values.tls ?? '',
  };
}

export function useProtocolConnect(protocol: string, category: string): ProtocolConnectHook {
  const [id, setId] = useState('');
  const [status, setStatus] = useState<ConnectStatus>('idle');
  const [error, setError] = useState('');

  const save = useCallback((values: Record<string, string>) => {
    void adminAPI.post('/connectors', { kind: 'protocol', protocol, category }, CreateSchema)
      .then((r) => adminAPI.postVoid(`/connectors/${r.id}/credentials`, credsFor(values)).then(() => r.id))
      .then(setId)
      .catch(() => setError('Could not save the connector configuration.'));
  }, [protocol, category]);

  const connect = useCallback(() => {
    setError('');
    void adminAPI.post(`/connectors/${id}/connect`, {}, ConnectSchema)
      .then((r) => {
        setStatus(r.connected ? 'connected' : 'not-connected');
        setError(r.connected ? '' : (r.error ?? 'The connection test failed.'));
      })
      .catch(() => { setStatus('not-connected'); setError('The connection test failed.'); });
  }, [id]);

  return { saved: id !== '', status, error, save, connect };
}
