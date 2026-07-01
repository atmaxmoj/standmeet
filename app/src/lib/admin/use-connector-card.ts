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
  schemes: z.array(z.string()).nullish(),
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
  schemes: readonly string[];
  connected: boolean;
  connecting: boolean;
  error: string;
  setField: (key: string, value: string) => void;
  setScope: (scope: string, checked: boolean) => void;
  connect: () => void;
  disconnect: () => void;
}

const SESSION_KEY = 'sm_connecting';

export function useConnectorCard(id: string): ConnectorCardHook {
  const [authType, setAuthType] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [schemes, setSchemes] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const values = useRef<Record<string, string>>({});
  const chosen = useRef<Set<string>>(new Set());

  const loadStatus = useCallback(() => {
    void adminAPI.get(`/connectors/${id}/status`, StatusSchema)
      .then((s) => {
        setConnected(s.connected);
        // 连上了 → 清掉「正在连」标记，免得下次别处的 connect_error 误落到本卡。
        s.connected && clearConnecting(id);
      })
      .catch(() => undefined);
  }, [id]);

  const loadForm = useCallback(() => {
    void adminAPI.get(`/connectors/${id}/credential-form`, FormSchema)
      .then((f) => {
        setAuthType(f.auth_type);
        setFields((f.fields ?? []).map((x) => x.key));
        setScopes(f.scopes ?? []);
        setSchemes(f.schemes ?? []);
      })
      .catch(() => undefined);
  }, [id]);

  useEffect(() => { loadStatus(); loadForm(); }, [loadStatus, loadForm]);

  // dance 回程带 ?connect_error=1 → 落到「正在连」的那张卡（sessionStorage 记的 id），显示友好
  // 错误（文案不漏底层 error code / stack）。落定后清标记。
  useEffect(() => {
    const failed = new URLSearchParams(window.location.search).get('connect_error') === '1';
    if (failed && window.sessionStorage.getItem(SESSION_KEY) === id) {
      setError('The connection didn’t complete. Check your credentials and try again.');
      clearConnecting(id);
    }
  }, [id]);

  // saveCreds —— 字段改动即存（带勾选 scope）。oauth2 的 Connect 是同步导航到 GET /authorize，
  // 没机会先 await 存凭据，故凭据必须在此提前存好；非 dance 同样复用已存凭据。
  const saveCreds = useCallback(() => {
    void adminAPI.postVoid(`/connectors/${id}/credentials`, {
      ...values.current, scopes: [...chosen.current],
    }).catch(() => setError('Couldn’t save credentials — check your connection and retry.'));
    // 存失败必须吵闹：否则 owner 以为凭据存好了，点 Connect 却用着未保存的凭据连接失败，一头雾水。
    // connect() 起头会 setError('')，故这条 save 错在下次点 Connect 时自然清掉。
  }, [id]);

  const connect = useCallback(() => {
    setError('');
    // oauth2 → 同步先翻「connecting…」（让 waitForURL 后的 expectConnected 真等到 dance 回程，
    // 因为 "connecting" 不匹配 /connected/）→ 起 dance（前端 window.location 跳 auth_url，回程
    // callback 重定向回 connectors 区，整页刷新后卡变 connected）。非 dance → XHR 存+连，无跳转。
    authType === 'oauth2'
      ? startDance(id, { setConnecting, setError })
      : runNonDanceConnect(id, { setConnecting, setConnected, setError });
  }, [id, authType]);

  const disconnect = useCallback(() => {
    void adminAPI.postVoid(`/connectors/${id}/disconnect`, {})
      .then(() => { setConnected(false); setError(''); })
      // 断开失败别静默：否则 owner 以为已断开，卡却还连着，状态与现实不符。
      .catch(() => setError('Couldn’t disconnect — check your connection and retry.'));
  }, [id]);

  return {
    authType, fields, scopes, schemes, connected, connecting, error,
    setField: (k, v) => { values.current[k] = v; saveCreds(); },
    setScope: (s, on) => { on ? chosen.current.add(s) : chosen.current.delete(s); saveCreds(); },
    connect, disconnect,
  };
}

// clearConnecting —— 清掉本卡的「正在连」标记（仅当记的就是本 id）。
function clearConnecting(id: string): void {
  if (window.sessionStorage.getItem(SESSION_KEY) === id) {
    window.sessionStorage.removeItem(SESSION_KEY);
  }
}

// startDance —— oauth2：同步翻 connecting + 记「正在连本 id」→ POST connect 取 auth_url → 整页跳过去
// 走 dance。auth_url 缺失 → 复位 connecting + 报错。
function startDance(
  id: string, set: { setConnecting: (b: boolean) => void; setError: (s: string) => void },
): void {
  set.setConnecting(true);
  window.sessionStorage.setItem(SESSION_KEY, id);
  void adminAPI.post(`/connectors/${id}/connect`, {}, ConnectSchema)
    .then((r) => {
      const url = r.auth_url ?? '';
      url === '' ? set.setConnecting(false) : (window.location.href = url);
    })
    .catch(() => { set.setConnecting(false); set.setError('The connection could not be completed.'); });
}

// runNonDanceConnect —— 非 oauth2（bearer/apikey）：凭据已即时存好 → 直接起连接，无跳转，原地翻
// 状态。先翻 connecting…（让 expectConnected 真等 POST 落定，而非被 "not connected" 宽松命中）。
function runNonDanceConnect(
  id: string,
  set: {
    setConnecting: (b: boolean) => void;
    setConnected: (b: boolean) => void;
    setError: (s: string) => void;
  },
): void {
  set.setConnecting(true);
  void adminAPI.post(`/connectors/${id}/connect`, {}, ConnectSchema)
    .then((r) => {
      set.setConnecting(false);
      set.setConnected(r.connected);
      set.setError(r.connected ? '' : (r.error ?? 'The connection test failed.'));
    })
    .catch(() => { set.setConnecting(false); set.setError('The connection could not be completed.'); });
}
