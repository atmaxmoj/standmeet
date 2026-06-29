// use-connector-card —— 一张连接器卡的装配生命周期（内置或上传）。读派生凭据表单 + 状态；owner
// 在 UI 填凭据 → Connect：先存凭据，再起连接。oauth2 → 后端给 auth_url → 同标签跳转走 dance →
// callback 换 token → 重定向回 /admin/connectors → 卡变 Connected。非 dance（bearer/apikey）→ 存
// 即连，无跳转。Disconnect → 清 token（留凭据）。逻辑住这里，卡片只渲染。

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const StatusSchema = z.object({
  connected: z.boolean(),
  has_credentials: z.boolean().nullish(),
});
const FormSchema = z.object({
  auth_type: z.string(),
  fields: z.array(z.object({ key: z.string() })).nullish(),
  scopes: z.array(z.string()).nullish(),
});
const ConnectSchema = z.object({
  auth_url: z.string().nullish(),
  connected: z.boolean(),
  error: z.string().nullish(),
});

export interface ConnectorCardHook {
  authType: string;
  fields: readonly string[];
  scopes: readonly string[];
  connected: boolean;
  error: string;
  setField: (key: string, value: string) => void;
  setScope: (scope: string, checked: boolean) => void;
  connect: () => void;
  disconnect: () => void;
}

export function useConnectorCard(id: string): ConnectorCardHook {
  const [authType, setAuthType] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const values = useRef<Record<string, string>>({});
  const chosen = useRef<Set<string>>(new Set());

  const loadStatus = useCallback(() => {
    void adminAPI.get(`/connectors/${id}/status`, StatusSchema)
      .then((s) => setConnected(s.connected))
      .catch(() => undefined);
  }, [id]);

  const loadForm = useCallback(() => {
    void adminAPI.get(`/connectors/${id}/credential-form`, FormSchema)
      .then((f) => {
        setAuthType(f.auth_type);
        setFields((f.fields ?? []).map((x) => x.key));
        setScopes(f.scopes ?? []);
      })
      .catch(() => undefined);
  }, [id]);

  useEffect(() => { loadStatus(); loadForm(); }, [loadStatus, loadForm]);

  // saveCreds —— 字段改动即存（带勾选 scope）。oauth2 的 Connect 是同步导航到 GET /authorize，
  // 没机会先 await 存凭据，故凭据必须在此提前存好；非 dance 同样复用已存凭据。
  const saveCreds = useCallback(() => {
    void adminAPI.postVoid(`/connectors/${id}/credentials`, {
      ...values.current, scopes: [...chosen.current],
    }).catch(() => undefined);
  }, [id]);

  const connect = useCallback(() => {
    setError('');
    // oauth2 → 同步整页导航起 dance（waitForURL 才能等到回程）；非 dance → XHR 存+连，无跳转。
    authType === 'oauth2'
      ? (window.location.href = `/api/admin/connectors/${id}/authorize`)
      : runNonDanceConnect(id, { setConnected, setError });
  }, [id, authType]);

  const disconnect = useCallback(() => {
    void adminAPI.postVoid(`/connectors/${id}/disconnect`, {})
      .then(() => setConnected(false))
      .catch(() => undefined);
  }, [id]);

  return {
    authType, fields, scopes, connected, error,
    setField: (k, v) => { values.current[k] = v; saveCreds(); },
    setScope: (s, on) => { on ? chosen.current.add(s) : chosen.current.delete(s); saveCreds(); },
    connect, disconnect,
  };
}

// runNonDanceConnect —— 非 oauth2（bearer/apikey）：凭据已即时存好 → 直接起连接，无跳转，原地翻状态。
function runNonDanceConnect(
  id: string, set: { setConnected: (b: boolean) => void; setError: (s: string) => void },
): void {
  void adminAPI.post(`/connectors/${id}/connect`, {}, ConnectSchema)
    .then((r) => {
      set.setConnected(r.connected);
      set.setError(r.connected ? '' : (r.error ?? 'The connection test failed.'));
    })
    .catch(() => set.setError('The connection could not be completed.'));
}
