// use-connectors —— /admin/connectors 的 local-state hook。
// 完全 client-side 占位：每个 connector 默认 disconnected, click "connect" 切换
// 但不调任何 backend；目的是给设计稿 UI 一个交互形态。

import { useState } from 'react';

export interface ConnectorView {
  id: string;
  name: string;
  note: string;
  // comingSoon —— 后端未接,catalog 预览,不可连接(不假装 connected)。Calendar
  // 是唯一真接通的,走独立 CalendarConnectorPanel,不在这张列表里。
  comingSoon: boolean;
  connected: boolean;
  account?: string;
  last_event?: string;
}

const SEED: ConnectorView[] = [
  { id: 'gmail',    name: 'Gmail',    note: 'Pull threads tagged #standmeet into raw inbox.', comingSoon: true, connected: false },
  { id: 'slack',    name: 'Slack',    note: 'Forward starred messages into raw.', comingSoon: true, connected: false },
  { id: 'telegram', name: 'Telegram', note: 'Visitors with a code can chat from inside Telegram.', comingSoon: true, connected: false },
  { id: 'discord',  name: 'Discord',  note: 'Same as Telegram, but for Discord.', comingSoon: true, connected: false },
];

export interface ConnectorsHook {
  connectors: readonly ConnectorView[];
}

export function useConnectors(): ConnectorsHook {
  // 全是 catalog 预览(后端未接)。去掉假 toggle —— 点了不再翻成 connected。
  const [connectors] = useState<ConnectorView[]>(SEED);
  return { connectors };
}
