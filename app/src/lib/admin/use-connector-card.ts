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
  // unreadable / reason —— 这台实例解不开这一行的密文了（换过实例密钥 / 密文被动过）。F-C-41。
  // 以前这种行让 status 和 list 整个 500，卡片于是渲成「你没连过」+ 一排空框 ——
  // 一句关于世界的假话，而库里密文和 connected_at 都还在。
  unreadable: z.boolean().nullish(),
  reason: z.string().nullish(),
});
const FormSchema = z.object({
  auth_type: z.string(),
  fields: z.array(z.object({ key: z.string() })).nullish(),
  scopes: z.array(z.string()).nullish(),
  schemes: z.array(z.string()).nullish(),
  // granted_scopes —— **已授**的那些（`scopes` 是这个连接器**支持**哪些）。两件事分开
  // 才谈得上把勾选框勾上；以前后端根本不报它，于是一条连着的连接看起来像什么权限都没有（F-C-33）。
  granted_scopes: z.array(z.string()).nullish(),
  // shortfall —— 这个授权**做不了的动作** + 各自还差哪个 scope（F-B-8）。
  // `connected` 说的是「手里有一个 token」，owner 读它时以为说的是「这个连接能干它
  // 被要求干的事」—— 只授了只读时那两件事分叉，而卡上原本一个字都不提。
  shortfall: z.array(z.object({
    operation: z.string(),
    needs: z.array(z.string()).nullish(),
  })).nullish(),
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
  /** 这个授权做不了的那几个 scope（去重后的名字）。空 = 声明过的动作它都做得了。 */
  missingScopes: readonly string[];
  schemes: readonly string[];
  connected: boolean;
  /** 后端说这个连接器已经存了凭据。值本身永远不回来 —— 卡片据此说「有」，而不是摆空框。 */
  hasCredentials: boolean;
  /** 这台实例读不懂这份凭据了（F-C-41）。空串 = 正常。非空 = 要 owner 重新连一次的那句话。 */
  unreadable: string;
  connecting: boolean;
  error: string;
  /**
   * 重新去后端问一次这张卡的状态（F-C-45）。
   *
   * 谁要它：卡上那些 owner 操作（探针、试发信）**会改变连接状态** —— 撤权之后跑一次探针，
   * 后端当场把这一行标成断开。而卡上的 `connected` 是进页面时取的那一份，于是同一屏上
   * 一句说「connected」、一句说「授权已被撤销」，其中一句是假的。
   *
   * 为什么不按错误类别分叉：状态的家在后端，卡只是**动作之后去问一次**。让每个操作各自
   * 记得「我这类失败要通知卡片」，下一个操作就会忘。
   */
  reloadStatus: () => void;
  setField: (key: string, value: string) => void;
  setScope: (scope: string, checked: boolean) => void;
  connect: () => void;
  disconnect: () => void;
}

const SESSION_KEY = 'sm_connecting';

// useConnectorStatus —— 一张卡的「状态」那一组：连没连 / 存没存凭据 / 这台实例还读不读得懂。
//
// 三个都来自**同一个端点**（`/status`），所以它们一起搬出来 —— 主 hook 到了 70 行的上限，
// 而闸门指的方向是对的：装配生命周期（填凭据 → connect → dance → disconnect）和
// 「这张卡现在是什么状态」是两件事。
function useConnectorStatus(id: string) {
  const [connected, setConnected] = useState(false);
  // hasCredentials —— 后端一直在回它（`connector-security` 验过：status 只回
  // `has_credentials: true`，凭据本身永远不回来）。而这个 hook 以前**取到就扔了**，
  // 于是卡片只能摆一排空框 —— owner 分不出「已存但隐藏」和「什么都没配」（UX-65）。
  // 不回值是对的（比打码更强的保密），但那就必须由界面把「有」这件事说出来。
  const [hasCredentials, setHasCredentials] = useState(false);
  // unreadable —— 这台实例解不开这份密文了（换过实例密钥 / 密文被动过）。F-C-41。
  const [unreadable, setUnreadable] = useState('');

  const loadStatus = useCallback(() => {
    void adminAPI.get(`/connectors/${id}/status`, StatusSchema)
      .then((s) => {
        setConnected(s.connected);
        setHasCredentials(s.has_credentials === true);
        setUnreadable(s.unreadable === true ? (s.reason ?? '') : '');
        // 连上了 → 清掉「正在连」标记，免得下次别处的 connect_error 误落到本卡。
        s.connected && clearConnecting(id);
      })
      .catch(() => undefined);
  }, [id]);

  return { connected, hasCredentials, unreadable, setConnected, loadStatus };
}

export function useConnectorCard(id: string): ConnectorCardHook {
  const [authType, setAuthType] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  // granted —— 这条连接**已经授出去**的范围（勾选框的初值）。
  const [granted, setGranted] = useState<string[]>([]);
  // missingScopes —— 卡上那句「这个授权做不了什么」要的名字（F-B-8）。
  const [missingScopes, setMissingScopes] = useState<string[]>([]);
  const [schemes, setSchemes] = useState<string[]>([]);
  const status = useConnectorStatus(id);
  const { connected, hasCredentials, unreadable, setConnected, loadStatus } = status;
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  // values / chosen —— owner 正在**编辑**的东西，只活在这一屏上。它们不是服务端状态：
  // 敲进去的字要到按下 Connect 那一刻才发出去（F-C-46）。
  const values = useRef<Record<string, string>>({});
  const chosen = useRef<Set<string>>(new Set());

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
        setMissingScopes(distinctNeeds(f.shortfall ?? []));
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

  // saveCreds —— 把这一屏编辑的东西存下去。**它是提交点，而按键不是**（F-C-46）。
  //
  // 以前每敲一个字符就存一遍。两条各自正确的规矩因此撞在一起：服务端「凭据真变了就清掉
  // connected」（D-5 / F-C-30），于是 owner **刚开始**改密码，那条还在用的连接就已经被标成
  // 没连了 —— 发码的信、预约确认信当场停摆，而卡上还写着 connected。改到一半走开、或者改完
  // 又放弃的人，留下的是一条不能用的连接。
  //
  // 现在只有 Connect 会调它：存完紧接着就验证，「变了要重验」那条规矩因此仍然成立，
  // 只是重验落在 owner 明确提交的那一刻。返回 promise —— Connect 必须等它落地：
  // 连接器在库里的那一行就是这一笔建的（后端对着不存在的行标 connected 会翻绿而库里空）。
  const saveCreds = useCallback(() => {
    // **一个字都没填就别存**：空的一笔照样会把连接器那一行建出来，而 connect 的那条
    // UPDATE 只要命中行就报「连上了」—— 于是「什么都没填也说连上了」（connector-connect-receipt
    // 钉的正是这件事）。以前存绑在按键上，空存不可能发生；提交点搬到 Connect 之后就可能了。
    if (Object.keys(values.current).length === 0 && chosen.current.size === 0) {
      return Promise.resolve();
    }
    // 存失败必须吵闹：否则 owner 以为凭据存好了，点 Connect 却用着未保存的凭据连接失败，一头雾水。
    // connect() 起头会 setError('')，故这条 save 错在下次点 Connect 时自然清掉。
    return adminAPI.postVoid(`/connectors/${id}/credentials`, {
      ...values.current, scopes: [...chosen.current],
    }).catch(() => setError('Couldn’t save credentials — check your connection and retry.'));
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
    void saveCreds().then(go);
  }, [id, authType, setConnected, saveCreds]);

  const disconnect = useCallback(() => {
    void adminAPI.postVoid(`/connectors/${id}/disconnect`, {})
      .then(() => { setConnected(false); setError(''); })
      // 断开失败别静默：否则 owner 以为已断开，卡却还连着，状态与现实不符。
      .catch(() => setError('Couldn’t disconnect — check your connection and retry.'));
  }, [id, setConnected]);

  return {
    authType, fields, scopes, granted, missingScopes, schemes, connected, hasCredentials,
    unreadable, connecting, error, reloadStatus: loadStatus,
    // 只记在这一屏上，不发出去 —— 提交点是 Connect（F-C-46）。
    setField: (k, v) => { values.current[k] = v; },
    setScope: (s, on) => { on ? chosen.current.add(s) : chosen.current.delete(s); },
    connect, disconnect,
  };
}

// distinctNeeds —— 把每个做不了的动作缺的 scope 并成一份名单（去重）。
// owner 要做的是「补上这几个再连一次」，不是逐个动作读一遍。
function distinctNeeds(
  rows: readonly { needs?: readonly string[] | null }[],
): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    for (const s of r.needs ?? []) seen.add(s);
  }
  return [...seen];
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
