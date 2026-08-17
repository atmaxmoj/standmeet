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
  // granted_scopes —— **已授**的那些（`scopes` 是这个连接器**支持**哪些）。两件事分开
  // 才谈得上把勾选框勾上；以前后端根本不报它，于是一条连着的连接看起来像什么权限都没有（F-C-33）。
  granted_scopes: z.array(z.string()).nullish(),
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
  /** 已授出去的范围。`scopes` 是可选清单，这是实际授了哪些 —— 勾选框读它（F-C-33）。 */
  granted: readonly string[];
  schemes: readonly string[];
  connected: boolean;
  /** 后端说这个连接器已经存了凭据。值本身永远不回来 —— 卡片据此说「有」，而不是摆空框。 */
  hasCredentials: boolean;
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
  // granted —— 这条连接**已经授出去**的范围（勾选框的初值）。
  const [granted, setGranted] = useState<string[]>([]);
  const [schemes, setSchemes] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  // hasCredentials —— 后端一直在回它（`connector-security` 验过：status 只回
  // `has_credentials: true`，凭据本身永远不回来）。而这个 hook 以前**取到就扔了**，
  // 于是卡片只能摆一排空框 —— owner 分不出「已存但隐藏」和「什么都没配」（UX-65）。
  // 不回值是对的（比打码更强的保密），但那就必须由界面把「有」这件事说出来。
  const [hasCredentials, setHasCredentials] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const values = useRef<Record<string, string>>({});
  const chosen = useRef<Set<string>>(new Set());
  // pendingSave —— 最近一笔存凭据。Connect 等它（见 saveCreds）；一次都没填过时是已完成的空 promise。
  const pendingSave = useRef<Promise<void>>(Promise.resolve());

  const loadStatus = useCallback(() => {
    void adminAPI.get(`/connectors/${id}/status`, StatusSchema)
      .then((s) => {
        setConnected(s.connected);
        setHasCredentials(s.has_credentials === true);
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
        // 已授的那些是**下一次保存的起点**：owner 想加一个 scope 时，发出去的必须是
        // 「原有 + 新勾的」，而不是「只有新勾的」—— 否则看一眼面板就悄悄缩小了授权范围。
        const granted = f.granted_scopes ?? [];
        chosen.current = new Set(granted);
        setGranted(granted);
      })
      // 表单没拉到别静默：否则卡片一片空白、owner 无从填凭据也不知为何。
      .catch(() => setError('Couldn’t load this connector’s setup form. Reload and retry.'));
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

  // saveCreds —— 字段改动即存（带勾选 scope）。**留住这个 promise**：连接器在库里的那一行就是
  // 这一笔建的，Connect 必须等它落地。以前这里是 fire-and-forget，owner 填完立刻点的话
  // connect 跑在它前面 —— 后端对着一张还不存在的行标 connected，卡片翻绿而库里什么都没有。
  const saveCreds = useCallback(() => {
    pendingSave.current = adminAPI.postVoid(`/connectors/${id}/credentials`, {
      ...values.current, scopes: [...chosen.current],
    }).catch(() => setError('Couldn’t save credentials — check your connection and retry.'));
    // 存失败必须吵闹：否则 owner 以为凭据存好了，点 Connect 却用着未保存的凭据连接失败，一头雾水。
    // connect() 起头会 setError('')，故这条 save 错在下次点 Connect 时自然清掉。
  }, [id]);

  const connect = useCallback(() => {
    setError('');
    // 同步翻「connecting…」：点下去立刻有反馈，且状态当场离开 "not connected"（"connecting"
    // 不匹配 /^connected$/，所以断言仍会真等到回程）。
    setConnecting(true);
    // 先等自己那笔存凭据落地，再起连接 —— 两条路都要等：非 dance 的 connect 要有行可标，
    // oauth2 的 dance 要在服务端读得到 client_id/secret。
    const go = authType === 'oauth2'
      ? () => startDance(id, { setConnecting, setError })
      : () => runNonDanceConnect(id, { setConnecting, setConnected, setError });
    void pendingSave.current.then(go);
  }, [id, authType]);

  const disconnect = useCallback(() => {
    void adminAPI.postVoid(`/connectors/${id}/disconnect`, {})
      .then(() => { setConnected(false); setError(''); })
      // 断开失败别静默：否则 owner 以为已断开，卡却还连着，状态与现实不符。
      .catch(() => setError('Couldn’t disconnect — check your connection and retry.'));
  }, [id]);

  return {
    authType, fields, scopes, granted, schemes, connected, hasCredentials, connecting, error,
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

// startDance —— oauth2：记「正在连本 id」→ POST connect 取 auth_url → 整页跳过去走 dance。
// auth_url 缺失 → 复位 connecting + 报错。（connecting 由 connect() 在点击当刻同步翻好，
// 这里不重复翻：翻它的时机得早于「等存凭据落地」，否则点下去有一段没反馈。）
function startDance(
  id: string, set: { setConnecting: (b: boolean) => void; setError: (s: string) => void },
): void {
  window.sessionStorage.setItem(SESSION_KEY, id);
  void adminAPI.post(`/connectors/${id}/connect`, {}, ConnectSchema)
    .then((r) => {
      const url = r.auth_url ?? '';
      url === '' ? set.setConnecting(false) : (window.location.href = url);
    })
    .catch(() => { set.setConnecting(false); set.setError('The connection could not be completed.'); });
}

// runNonDanceConnect —— 非 oauth2（bearer/apikey）：凭据已落地（connect() 等过）→ 直接起连接，
// 无跳转，原地翻状态。connected:false 时后端一定给了理由（连接测试失败 / 还没存凭据），照原样显示。
function runNonDanceConnect(
  id: string,
  set: {
    setConnecting: (b: boolean) => void;
    setConnected: (b: boolean) => void;
    setError: (s: string) => void;
  },
): void {
  void adminAPI.post(`/connectors/${id}/connect`, {}, ConnectSchema)
    .then((r) => {
      set.setConnecting(false);
      set.setConnected(r.connected);
      set.setError(r.connected ? '' : (r.error ?? 'The connection test failed.'));
    })
    .catch(() => { set.setConnecting(false); set.setError('The connection could not be completed.'); });
}
