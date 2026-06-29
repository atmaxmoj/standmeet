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

export type ConnectStatus = 'idle' | 'connecting' | 'connected' | 'not-connected';

export interface ProtocolConnectHook {
  saved: boolean;
  status: ConnectStatus;
  error: string;
  save: (values: Record<string, string>) => void;
  connect: () => void;
  saveAndConnect: (values: Record<string, string>) => void;
}

// credsFor —— 表单值 → 协议凭据 JSON（归一：原样透传；仅 from → from_address 对齐 SMTP 后端形状）。
// SMTP 用 host/port/username/password/from/tls；CalDAV 用 url/username/password/tls —— 同一映射皆可。
function credsFor(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...values };
  if (out.from !== undefined) {
    out.from_address = out.from;
    delete out.from;
  }
  return out;
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

  const applyConnect = useCallback((r: z.infer<typeof ConnectSchema>) => {
    setStatus(r.connected ? 'connected' : 'not-connected');
    setError(r.connected ? '' : (r.error ?? 'The connection test failed.'));
  }, []);

  const connect = useCallback(() => {
    setError('');
    void adminAPI.post(`/connectors/${id}/connect`, {}, ConnectSchema)
      .then(applyConnect)
      .catch(() => { setStatus('not-connected'); setError('The connection test failed.'); });
  }, [id, applyConnect]);

  // saveAndConnect —— 一键：建协议连接器 + 存凭据 → 立即连接测试（归一装配视图的协议路，owner 填完
  // 点一次 Connect 即成）。串行用上一步返回的 id，避开 save→connect 的状态竞态。
  const saveAndConnect = useCallback((values: Record<string, string>) => {
    setError('');
    setStatus('connecting'); // 同步翻 connecting…，让 expectConnected 真等到 connect 落定（不被 "not connected" 宽松命中）

    void adminAPI.post('/connectors', { kind: 'protocol', protocol, category }, CreateSchema)
      .then((r) => {
        setId(r.id);
        return adminAPI.postVoid(`/connectors/${r.id}/credentials`, credsFor(values))
          .then(() => adminAPI.post(`/connectors/${r.id}/connect`, {}, ConnectSchema));
      })
      .then(applyConnect)
      .catch(() => { setStatus('not-connected'); setError('The connection test failed.'); });
  }, [protocol, category, applyConnect]);

  return { saved: id !== '', status, error, save, connect, saveAndConnect };
}
