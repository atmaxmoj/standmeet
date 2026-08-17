// redirect-uri.ts —— 连接器那个「拿去 SaaS 注册」的回调地址（F-C-32）。
//
// 这个值的**唯一**用途是被粘进第三方控制台的 "Authorized redirect URIs"，而那里只收
// **绝对**地址：Google / Notion / 任何一家都会当场拒收 `/api/...` 这种相对路径。
// 以前卡上直接硬编码了路径，于是这个控件做不到它被摆在那儿要做的那件事。
//
// 绝对地址里的 origin **只能由运行中的实例给**：owner 的域名和端口是部署期才知道的，
// 而且同一个实例可能从好几个地址访问得到（localhost、LAN、公网域名）。要注册的那一个，
// 正是 owner **此刻用来看这一页的**那个 —— 所以取 `window.location.origin`，不是任何常量。

import { useEffect, useState } from 'react';

/** connectorCallbackPath —— 回调在这个实例上的路径（origin 之外的那一半）。 */
export function connectorCallbackPath(connectorID: string): string {
  return `/api/admin/connectors/${connectorID}/callback`;
}

/**
 * useConnectorRedirectURI —— 完整的、可粘贴的回调地址。
 * SSR 没有 window，先给路径（渲染得出东西，且不假装它是 URI）；挂载后换成绝对地址。
 */
export function useConnectorRedirectURI(connectorID: string): string {
  const path = connectorCallbackPath(connectorID);
  const [uri, setURI] = useState(path);
  useEffect(() => setURI(`${window.location.origin}${path}`), [path]);
  return uri;
}
